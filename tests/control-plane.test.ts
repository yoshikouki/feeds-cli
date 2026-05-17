import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dispatchPendingEvents } from "../src/control-plane/events";
import {
  defaultPipelineId,
  defaultScheduledScanJob,
  workspaceIdFromBaseDir,
} from "../src/control-plane/identity";
import { planDueJobs } from "../src/control-plane/heartbeat";
import type { EventEnvelope } from "../src/contracts/event";
import { FeedDatabase } from "../src/db";

describe("control plane phase 1", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root) {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  test("planDueJobs treats interval jobs as heartbeat-driven execution state", () => {
    const baseDir = "/tmp/feeds-heartbeat";
    const job = defaultScheduledScanJob(baseDir, "5m");
    const now = new Date("2026-04-27T10:00:00.000Z");

    expect(planDueJobs([job], new Map(), now)).toEqual([job]);

    const latestRun = {
      id: "run-1",
      workspaceId: job.workspaceId,
      pipelineId: job.pipelineId,
      jobId: job.id,
      purpose: "scan" as const,
      triggeredBy: "heartbeat" as const,
      status: "success" as const,
      startedAt: new Date("2026-04-27T09:56:00.000Z").toISOString() as any,
      finishedAt: new Date("2026-04-27T09:56:01.000Z").toISOString() as any,
      durationMs: 100,
      errorMessage: null,
    };

    expect(planDueJobs([job], new Map([[job.id, latestRun]]), now)).toEqual([]);
  });

  test("stale running job becomes due again and reports stale health", async () => {
    const root = await mkdtemp(join(tmpdir(), "feeds-stale-job-"));
    tempRoots.push(root);
    const dbPath = join(root, "feeds.db");
    const job = defaultScheduledScanJob(root, "5m");
    const startedAt = "2026-04-27T09:40:00.000Z";
    const now = new Date("2026-04-27T09:51:00.000Z");

    using db = new FeedDatabase(dbPath);
    const jobRunId = db.insertJobRun({
      workspaceId: job.workspaceId,
      pipelineId: job.pipelineId,
      jobId: job.id,
      purpose: job.purpose,
      triggeredBy: "heartbeat",
    });
    db.sqlite.run(
      "UPDATE job_runs SET started_at = ?, status = 'running', finished_at = NULL WHERE id = ?",
      [startedAt, jobRunId],
    );

    const latestRun = db.latestJobRun(job.id);
    expect(planDueJobs([job], new Map([[job.id, latestRun]]), now)).toEqual([job]);

    const health = db.jobExecutionHealth(job, now);
    expect(health.status).toBe("stale");
    expect(health.lastStartedAt).toBe(startedAt);
    expect(health.lastFinishedAt).toBeNull();
  });

  test("dispatchPendingEvents records hook runs from persisted entry events", async () => {
    const root = await mkdtemp(join(tmpdir(), "feeds-control-plane-"));
    tempRoots.push(root);
    const hooksDir = join(root, "hooks");
    const outFile = join(root, "hook-output.json");
    const dbPath = join(root, "feeds.db");

    await mkdir(hooksDir, { recursive: true });
    await writeFile(
      join(hooksDir, "on-new-articles.sh"),
      `#!/bin/sh\ncat > "${outFile}"\n`,
      { mode: 0o755 },
    );

    using db = new FeedDatabase(dbPath);
    const workspaceId = workspaceIdFromBaseDir(root);
    const pipelineId = defaultPipelineId(workspaceId);

    db.insertEvent({
      id: crypto.randomUUID() as EventEnvelope["id"],
      kind: "entry.discovered",
      workspaceId,
      pipelineId,
      occurredAt: new Date().toISOString() as EventEnvelope["occurredAt"],
      payload: {
        entryId: "entry-1",
        sourceId: "source-1",
        scanRunId: "scan-1",
        discoveredAt: new Date().toISOString(),
        feedId: "feed-1",
        feedName: "example",
        title: "Hello",
        url: "https://example.com/hello",
        publishedAt: null,
        summary: "World",
      },
    });

    await dispatchPendingEvents(db, {
      base: root,
      hooksDir,
      hooksEnabled: true,
    });

    const body = await Bun.file(outFile).text();
    expect(body).toContain("\"Hello\"");
    expect(db.countEventsByStatus(workspaceId, "pending")).toBe(0);

    const hookRunCount = db.sqlite
      .query("SELECT COUNT(*) as count FROM hook_runs")
      .get() as { count: number | bigint };
    expect(Number(hookRunCount.count)).toBe(1);
  });

  test("failed event retry skips hooks that already succeeded", async () => {
    const root = await mkdtemp(join(tmpdir(), "feeds-control-plane-retry-"));
    tempRoots.push(root);
    const hooksDir = join(root, "hooks");
    const outFile = join(root, "hook-output.log");
    const gateFile = join(root, "allow-second-hook");
    const dbPath = join(root, "feeds.db");

    await mkdir(hooksDir, { recursive: true });
    await writeFile(
      join(hooksDir, "on-new-articles.a.sh"),
      `#!/bin/sh\necho "a" >> "${outFile}"\n`,
      { mode: 0o755 },
    );
    await writeFile(
      join(hooksDir, "on-new-articles.b.sh"),
      `#!/bin/sh\nif [ -f "${gateFile}" ]; then\n  echo "b" >> "${outFile}"\n  exit 0\nfi\nexit 1\n`,
      { mode: 0o755 },
    );

    using db = new FeedDatabase(dbPath);
    const workspaceId = workspaceIdFromBaseDir(root);
    const pipelineId = defaultPipelineId(workspaceId);
    const eventId = crypto.randomUUID() as EventEnvelope["id"];

    db.insertEvent({
      id: eventId,
      kind: "entry.discovered",
      workspaceId,
      pipelineId,
      occurredAt: new Date().toISOString() as EventEnvelope["occurredAt"],
      payload: {
        entryId: "entry-1",
        sourceId: "source-1",
        scanRunId: "scan-1",
        discoveredAt: new Date().toISOString(),
        feedId: "feed-1",
        feedName: "example",
        title: "Hello",
        url: "https://example.com/hello",
        publishedAt: null,
        summary: "World",
      },
    });

    await dispatchPendingEvents(db, {
      base: root,
      hooksDir,
      hooksEnabled: true,
    });

    expect(db.countEventsByStatus(workspaceId, "failed")).toBe(1);
    expect((await Bun.file(outFile).text()).trim().split("\n")).toEqual(["a"]);

    await writeFile(gateFile, "ok");
    await dispatchPendingEvents(db, {
      base: root,
      hooksDir,
      hooksEnabled: true,
    });

    expect(db.countEventsByStatus(workspaceId, "failed")).toBe(0);
    expect(db.countEventsByStatus(workspaceId, "dispatched")).toBe(1);
    expect((await Bun.file(outFile).text()).trim().split("\n")).toEqual(["a", "b"]);

    const hookRuns = db.sqlite
      .query(
        "SELECT hook_key as hookKey, status, attempt FROM hook_runs WHERE event_id = ? ORDER BY hook_key ASC, attempt ASC",
      )
      .all(eventId) as Array<{ hookKey: string; status: string; attempt: number }>;
    expect(hookRuns).toEqual([
      {
        hookKey: join(hooksDir, "on-new-articles.a.sh"),
        status: "success",
        attempt: 1,
      },
      {
        hookKey: join(hooksDir, "on-new-articles.b.sh"),
        status: "failed",
        attempt: 1,
      },
      {
        hookKey: join(hooksDir, "on-new-articles.b.sh"),
        status: "success",
        attempt: 2,
      },
    ]);
  });

  test("lists control-plane history by workspace", () => {
    using db = new FeedDatabase(":memory:");
    const baseDir = "/tmp/feeds-control-plane-history";
    const otherBaseDir = "/tmp/feeds-control-plane-other";
    const workspaceId = workspaceIdFromBaseDir(baseDir);
    const pipelineId = defaultPipelineId(workspaceId);
    const job = defaultScheduledScanJob(baseDir, "5m");
    const otherWorkspaceId = workspaceIdFromBaseDir(otherBaseDir);
    const otherPipelineId = defaultPipelineId(otherWorkspaceId);
    const otherJob = defaultScheduledScanJob(otherBaseDir, "5m");
    const eventId = crypto.randomUUID() as EventEnvelope["id"];
    const otherEventId = crypto.randomUUID() as EventEnvelope["id"];

    const jobRunId = db.insertJobRun({
      workspaceId,
      pipelineId,
      jobId: job.id,
      purpose: job.purpose,
      triggeredBy: "manual",
    });
    db.finishJobRun(jobRunId, "success");
    db.sqlite.run(
      "UPDATE job_runs SET started_at = ?, finished_at = ?, duration_ms = ? WHERE id = ?",
      ["2026-05-01T10:00:00.000Z", "2026-05-01T10:00:02.000Z", 2000, jobRunId],
    );

    db.insertJobRun({
      workspaceId: otherWorkspaceId,
      pipelineId: otherPipelineId,
      jobId: otherJob.id,
      purpose: otherJob.purpose,
      triggeredBy: "manual",
    });

    db.insertEvent({
      id: eventId,
      kind: "cycle.completed",
      workspaceId,
      pipelineId,
      occurredAt: "2026-05-01T10:00:03.000Z" as EventEnvelope["occurredAt"],
      payload: {
        scanRunId: "scan-1",
        completedAt: "2026-05-01T10:00:03.000Z",
        totalFeeds: 1,
        totalNewEntries: 2,
        durationMs: 2000,
        hadErrors: false,
      },
    });
    db.markEventDispatched(eventId);

    db.insertEvent({
      id: otherEventId,
      kind: "cycle.completed",
      workspaceId: otherWorkspaceId,
      pipelineId: otherPipelineId,
      occurredAt: "2026-05-01T10:00:04.000Z" as EventEnvelope["occurredAt"],
      payload: {
        scanRunId: "scan-2",
        completedAt: "2026-05-01T10:00:04.000Z",
        totalFeeds: 1,
        totalNewEntries: 0,
        durationMs: 1000,
        hadErrors: false,
      },
    });

    db.recordHookRun({
      eventId,
      workspaceId,
      pipelineId,
      hookKey: "/tmp/on-cycle-complete.sh",
      attempt: 1,
      status: "success",
      startedAt: "2026-05-01T10:00:04.000Z",
      finishedAt: "2026-05-01T10:00:05.000Z",
      exitCode: 0,
      errorMessage: null,
    });
    db.recordHookRun({
      eventId: otherEventId,
      workspaceId: otherWorkspaceId,
      pipelineId: otherPipelineId,
      hookKey: "/tmp/other-hook.sh",
      attempt: 1,
      status: "success",
      startedAt: "2026-05-01T10:00:06.000Z",
      finishedAt: "2026-05-01T10:00:07.000Z",
      exitCode: 0,
      errorMessage: null,
    });

    expect(db.listJobRuns({ workspaceId }).map((run) => run.id)).toEqual([jobRunId]);
    expect(db.listEvents({ workspaceId }).map((record) => record.event.id)).toEqual([eventId]);
    expect(db.listHookRuns({ workspaceId }).map((run) => run.eventId)).toEqual([eventId]);

    expect(db.listEvents({ workspaceId, since: "2026-05-01T10:00:04.000Z" })).toEqual([]);
    expect(db.listHookRuns({ workspaceId, limit: 1 })).toEqual([
      expect.objectContaining({
        eventId,
        hookKey: "/tmp/on-cycle-complete.sh",
        attempt: 1,
        exitCode: 0,
      }),
    ]);
  });
});
