import { dirname, join } from "node:path";
import { outputError, outputInfo, outputWarn } from "../cli/output.ts";
import type { JobExecutionHealth } from "../contracts/control-plane.ts";
import type {
  CycleCompletedPayload,
  EntryDiscoveredPayload,
  EventEnvelope,
  ScanCompletedPayload,
  ScanFailedPayload,
  ScanStartedPayload,
} from "../contracts/event.ts";
import type { PipelineId, WorkspaceId } from "../contracts/primitives.ts";
import { loadConfig } from "../config/index.ts";
import { dispatchPendingEvents } from "../control-plane/events.ts";
import {
  defaultPipelineId,
  workspaceIdFromBaseDir,
} from "../control-plane/identity.ts";
import { HEARTBEAT_CRON_SCHEDULE } from "../control-plane/heartbeat.ts";
import { FeedDatabase } from "../db/index.ts";
import { ensureDir, type ResolvedPaths } from "../paths.ts";
import { scanFeed, type ScanResult } from "../scanner.ts";
import type { CycleTrigger } from "../types.ts";
import { runHooks } from "./hooks.ts";
import { cronJobTitle } from "./job-id.ts";
import {
  clearCronRuntime,
  loadCronRuntime,
  loadCronRuntimeState,
  runtimeWithDefaultScanJob,
  saveCronRuntime,
  type CronRuntime,
  type CronRuntimeState,
} from "./runtime.ts";

const WORKER_PATH = join(dirname(import.meta.filename), "worker.ts");

/**
 * Convert an interval string like "30m", "1h" to a cron expression.
 * Phase 1 keeps this validator for CLI ergonomics even though the control plane
 * now stores interval-based scan jobs behind a 1-minute heartbeat.
 */
export function intervalToCron(input: string): string {
  const match = input.match(/^(\d+)(m|h)$/);
  if (!match) throw new Error(`Invalid interval: ${input} (use e.g. 30m, 1h)`);
  const value = Number(match[1]);
  const unit = match[2];
  switch (unit) {
    case "m":
      if (value > 0 && 60 % value === 0) return `*/${value} * * * *`;
      return `*/${value} * * * *`;
    case "h":
      if (value === 1) return `0 * * * *`;
      return `0 */${value} * * *`;
    default:
      throw new Error(`Invalid interval unit: ${unit}`);
  }
}

/**
 * Run a single scan cycle over all feeds.
 * Phase 1 persists feed events and dispatches hooks from the event log instead
 * of invoking hooks inline during scan orchestration.
 */
export async function runCycle(
  paths: ResolvedPaths,
  trigger: CycleTrigger = "manual",
  dbOverride?: FeedDatabase,
): Promise<void> {
  const cycleStart = performance.now();
  const config = await loadConfig(paths.config);
  const workspaceId = workspaceIdFromBaseDir(paths.base);
  const pipelineId = defaultPipelineId(workspaceId);

  if (config.feeds.length === 0) {
    outputWarn("No feeds in config, skipping cycle.");
    return;
  }

  const ownDb = dbOverride ? null : new FeedDatabase(paths.db);
  const db = dbOverride ?? ownDb!;
  const cycleId = db.insertCycleLog(trigger);
  let totalNew = 0;
  let hasErrors = false;

  try {
    for (const feedDef of config.feeds) {
      const sourceIds = feedDef.sources
        .map((source) => source.id)
        .filter((sourceId): sourceId is string => typeof sourceId === "string");
      const feedId = feedDef.id ?? "";

      db.insertEvent(
        createEvent<"scan.started", ScanStartedPayload>(
          workspaceId,
          pipelineId,
          "scan.started",
          {
            scanRunId: cycleId as ScanStartedPayload["scanRunId"],
            sourceIds: sourceIds as unknown as ScanStartedPayload["sourceIds"],
            feedId,
            feedName: feedDef.name,
              startedAt: nowIso(),
          },
        ),
      );

      let result: ScanResult;
      try {
        result = await scanFeed(db, feedDef, cycleId);
      } catch (err) {
        hasErrors = true;
        const message = err instanceof Error ? err.message : String(err);
        outputError(`Scan failed for ${feedDef.name}: ${message}`);
        db.insertEvent(
          createEvent<"scan.failed", ScanFailedPayload>(
            workspaceId,
            pipelineId,
            "scan.failed",
            {
              scanRunId: cycleId as ScanFailedPayload["scanRunId"],
              sourceIds: sourceIds as unknown as ScanFailedPayload["sourceIds"],
              feedId,
              feedName: feedDef.name,
              failedAt: nowIso(),
              errorMessage: message,
            },
          ),
        );
        continue;
      }

      db.insertEvent(
        createEvent<"scan.completed", ScanCompletedPayload>(
          workspaceId,
          pipelineId,
          "scan.completed",
          {
            scanRunId: cycleId as ScanCompletedPayload["scanRunId"],
            sourceIds: sourceIds as unknown as ScanCompletedPayload["sourceIds"],
            feedId: feedId || result.feedId,
            feedName: result.feedName,
            scannedAt: nowIso(),
            discoveredEntryCount: result.articlesInserted,
            articlesFound: result.articlesFound,
            articlesInserted: result.articlesInserted,
          },
        ),
      );

      for (const article of result.newArticles) {
        db.insertEvent(
          createEvent<"entry.discovered", EntryDiscoveredPayload>(
            workspaceId,
            pipelineId,
            "entry.discovered",
            {
              entryId: article.id as EntryDiscoveredPayload["entryId"],
              sourceId: (sourceIds[0] ?? "") as EntryDiscoveredPayload["sourceId"],
              scanRunId: cycleId as EntryDiscoveredPayload["scanRunId"],
              discoveredAt: nowIso(),
              feedId: feedId || result.feedId,
              feedName: result.feedName,
              title: article.title,
              url: article.url,
              publishedAt: article.publishedAt as EntryDiscoveredPayload["publishedAt"],
              summary: article.summary,
            },
          ),
        );
      }

      totalNew += result.articlesInserted;
      if (result.errors.length > 0) {
        hasErrors = true;
      }

      for (const err of result.errors) {
        outputWarn(err);
      }

      outputInfo(
        `${result.feedName}: ${result.articlesInserted} new / ${result.articlesFound} found`,
      );
    }

    const durationMs = Math.round(performance.now() - cycleStart);
    db.finishCycleLog(cycleId, hasErrors ? "error" : "success", durationMs);
    db.insertEvent(
      createEvent<"cycle.completed", CycleCompletedPayload>(
        workspaceId,
        pipelineId,
        "cycle.completed",
        {
          scanRunId: cycleId as CycleCompletedPayload["scanRunId"],
          completedAt: nowIso(),
          totalFeeds: config.feeds.length,
          totalNewEntries: totalNew,
          durationMs,
          hadErrors: hasErrors,
        },
      ),
    );

    await dispatchPendingEvents(db, paths);
    db.pruneLogs();
    outputInfo(`Cycle complete: ${totalNew} new articles in ${durationMs}ms`);
  } catch (err) {
    const durationMs = Math.round(performance.now() - cycleStart);
    const message = err instanceof Error ? err.message : String(err);
    db.finishCycleLog(cycleId, "error", durationMs, message);
    throw err;
  } finally {
    ownDb?.close();
  }
}

export async function maybeRunHooks(
  paths: Pick<ResolvedPaths, "hooksDir" | "hooksEnabled">,
  params: Parameters<typeof runHooks>[1],
): Promise<void> {
  if (!paths.hooksEnabled) {
    return;
  }

  await runHooks(paths.hooksDir, params);
}

export async function prepareCyclePaths(paths: Pick<ResolvedPaths, "base">): Promise<void> {
  await ensureDir(paths.base);
}

// ─── Cron job management via Bun.cron() ───

export async function cronStart(
  every: string,
  paths: ResolvedPaths,
): Promise<void> {
  const jobTitle = cronJobTitle(paths.base);
  const previousRuntime = await loadCronRuntime(jobTitle);
  await saveCronRuntime(runtimeWithDefaultScanJob(paths, every), jobTitle);

  try {
    await Bun.cron(WORKER_PATH, HEARTBEAT_CRON_SCHEDULE, jobTitle);
  } catch (err) {
    if (previousRuntime) {
      await saveCronRuntime(previousRuntime, jobTitle);
    } else {
      await clearCronRuntime(jobTitle);
    }
    throw err;
  }

  outputInfo(
    `Heartbeat registered: "${HEARTBEAT_CRON_SCHEDULE}" (${jobTitle}), scan interval ${every}`,
  );
}

export async function cronStop(baseDir: string): Promise<void> {
  const jobTitle = cronJobTitle(baseDir);
  await Bun.cron.remove(jobTitle);
  await clearCronRuntime(jobTitle);
  outputInfo("Cron job removed.");
}

export function cronNextRun(schedule: string): Date | null {
  return Bun.cron.parse(schedule);
}

export interface CronStatus {
  jobTitle: string;
  registered: boolean;
  heartbeatSchedule: string | null;
  nextHeartbeatRun: Date | null;
  runtimeState: CronRuntimeState["status"] | null;
  runtime: CronRuntime | null;
  execution: JobExecutionHealth[];
  failedEvents: number;
  pendingEvents: number;
  failedHookRuns: number;
}

export async function cronStatus(baseDir: string): Promise<CronStatus> {
  const jobTitle = cronJobTitle(baseDir);
  const platform = process.platform;

  if (platform === "darwin") {
    return await cronStatusMacOS(jobTitle);
  }
  if (platform === "linux") {
    return await cronStatusLinux(jobTitle);
  }

  return {
    jobTitle,
    registered: false,
    heartbeatSchedule: null,
    nextHeartbeatRun: null,
    runtimeState: null,
    runtime: null,
    ...emptyExecutionSnapshot(),
  };
}

async function cronStatusMacOS(jobTitle: string): Promise<CronStatus> {
  const plistPath = `${process.env.HOME}/Library/LaunchAgents/bun.cron.${jobTitle}.plist`;
  const exists = await Bun.file(plistPath).exists();
  if (!exists) {
    return {
      jobTitle,
      registered: false,
      heartbeatSchedule: null,
      nextHeartbeatRun: null,
      runtimeState: null,
      runtime: null,
      ...emptyExecutionSnapshot(),
    };
  }

  const proc = Bun.spawn(["launchctl", "list"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(proc.stdout).text();
  const registered = output.includes(`bun.cron.${jobTitle}`);
  const heartbeatSchedule = await extractScheduleFromPlist(plistPath);
  const nextHeartbeatRun = heartbeatSchedule ? Bun.cron.parse(heartbeatSchedule) : null;
  const runtimeState = registered ? await loadCronRuntimeState(jobTitle) : null;
  const runtime = runtimeState?.status === "ok" ? runtimeState.runtime : null;

  return {
    jobTitle,
    registered,
    heartbeatSchedule,
    nextHeartbeatRun,
    runtimeState: runtimeState?.status ?? null,
    runtime,
    ...(runtime ? await executionSnapshot(runtime) : emptyExecutionSnapshot()),
  };
}

async function extractScheduleFromPlist(plistPath: string): Promise<string | null> {
  try {
    const content = await Bun.file(plistPath).text();
    const match = content.match(/--cron-period='([^']+)'/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function cronStatusLinux(jobTitle: string): Promise<CronStatus> {
  const proc = Bun.spawn(["crontab", "-l"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(proc.stdout).text();
  const lines = output.split("\n");

  let foundMarker = false;
  for (const line of lines) {
    if (line.trim() === `# bun-cron: ${jobTitle}`) {
      foundMarker = true;
      continue;
    }
    if (foundMarker && line.trim()) {
      const periodMatch = line.match(/--cron-period='([^']+)'/);
      const heartbeatSchedule = periodMatch?.[1] ?? null;
      const nextHeartbeatRun = heartbeatSchedule ? Bun.cron.parse(heartbeatSchedule) : null;
      const runtimeState = await loadCronRuntimeState(jobTitle);
      const runtime = runtimeState.status === "ok" ? runtimeState.runtime : null;
      return {
        jobTitle,
        registered: true,
        heartbeatSchedule,
        nextHeartbeatRun,
        runtimeState: runtimeState.status,
        runtime,
        ...(runtime ? await executionSnapshot(runtime) : emptyExecutionSnapshot()),
      };
    }
  }

  return {
    jobTitle,
    registered: false,
    heartbeatSchedule: null,
    nextHeartbeatRun: null,
    runtimeState: null,
    runtime: null,
    ...emptyExecutionSnapshot(),
  };
}

async function executionSnapshot(runtime: CronRuntime): Promise<{
  execution: JobExecutionHealth[];
  failedEvents: number;
  pendingEvents: number;
  failedHookRuns: number;
}> {
  using db = new FeedDatabase(runtime.db);
  const workspaceId = workspaceIdFromBaseDir(runtime.baseDir);

  return {
    execution: runtime.jobs.map((job) => db.jobExecutionHealth(job)),
    failedEvents: db.countEventsByStatus(workspaceId, "failed"),
    pendingEvents: db.countEventsByStatus(workspaceId, "pending"),
    failedHookRuns: db.countFailedHookRuns(workspaceId),
  };
}

function emptyExecutionSnapshot(): {
  execution: JobExecutionHealth[];
  failedEvents: number;
  pendingEvents: number;
  failedHookRuns: number;
} {
  return {
    execution: [],
    failedEvents: 0,
    pendingEvents: 0,
    failedHookRuns: 0,
  };
}

function createEvent<TKind extends EventEnvelope["kind"], TPayload extends EventEnvelope["payload"]>(
  workspaceId: WorkspaceId,
  pipelineId: PipelineId,
  kind: TKind,
  payload: TPayload,
): EventEnvelope<TKind, TPayload> {
  return {
    id: crypto.randomUUID() as EventEnvelope<TKind, TPayload>["id"],
    kind,
    workspaceId,
    pipelineId,
    occurredAt: nowIso() as EventEnvelope<TKind, TPayload>["occurredAt"],
    payload,
  };
}

function nowIso(): EventEnvelope["occurredAt"] {
  return new Date().toISOString() as EventEnvelope["occurredAt"];
}
