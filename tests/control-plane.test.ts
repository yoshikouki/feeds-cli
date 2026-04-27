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

    expect(planDueJobs([job], new Map())).toEqual([job]);

    const latestRun = {
      id: "run-1",
      workspaceId: job.workspaceId,
      pipelineId: job.pipelineId,
      jobId: job.id,
      purpose: "scan" as const,
      triggeredBy: "heartbeat" as const,
      status: "success" as const,
      startedAt: new Date().toISOString() as any,
      finishedAt: new Date().toISOString() as any,
      durationMs: 100,
      errorMessage: null,
    };

    expect(planDueJobs([job], new Map([[job.id, latestRun]]))).toEqual([]);
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
});
