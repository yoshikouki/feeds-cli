import { dirname, join } from "node:path";
import { rm } from "node:fs/promises";
import type { ScheduledJobSpec } from "../contracts/scheduler.ts";
import {
  DEFAULT_BASE_DIR,
  ensureDir,
  type ResolvedPaths,
} from "../paths.ts";
import { cronJobTitle } from "./job-id.ts";
import { defaultScheduledScanJob } from "../control-plane/identity.ts";
import { HEARTBEAT_CRON_SCHEDULE } from "../control-plane/heartbeat.ts";

export interface CronRuntime {
  baseDir: string;
  config: string;
  db: string;
  hooksDir: string;
  hooksEnabled: boolean;
  heartbeatSchedule: string;
  jobs: readonly ScheduledJobSpec[];
}

export type CronRuntimeState =
  | { status: "ok"; runtime: CronRuntime }
  | { status: "missing"; runtime: null }
  | { status: "invalid"; runtime: null };

export function cronRuntimeStatePath(
  jobTitle: string,
  controlBaseDir: string = DEFAULT_BASE_DIR,
): string {
  return join(controlBaseDir, "cron", "jobs", `${jobTitle}.runtime.json`);
}

export function cronRuntimeStatePathForBaseDir(
  baseDir: string,
  controlBaseDir: string = DEFAULT_BASE_DIR,
): string {
  return cronRuntimeStatePath(cronJobTitle(baseDir), controlBaseDir);
}

export function runtimeFromPaths(
  paths: ResolvedPaths,
  jobs: readonly ScheduledJobSpec[] = [],
): CronRuntime {
  return {
    baseDir: paths.base,
    config: paths.config,
    db: paths.db,
    hooksDir: paths.hooksDir,
    hooksEnabled: paths.hooksEnabled,
    heartbeatSchedule: HEARTBEAT_CRON_SCHEDULE,
    jobs,
  };
}

export function runtimeWithDefaultScanJob(
  paths: ResolvedPaths,
  every: string,
): CronRuntime {
  return runtimeFromPaths(paths, [defaultScheduledScanJob(paths.base, every)]);
}

export function pathsFromRuntime(runtime: CronRuntime): ResolvedPaths {
  return {
    base: runtime.baseDir,
    config: runtime.config,
    db: runtime.db,
    hooksDir: runtime.hooksDir,
    hooksEnabled: runtime.hooksEnabled,
  };
}

export async function saveCronRuntime(
  runtime: CronRuntime,
  jobTitle: string,
  controlBaseDir: string = DEFAULT_BASE_DIR,
): Promise<void> {
  const statePath = cronRuntimeStatePath(jobTitle, controlBaseDir);
  await ensureDir(dirname(statePath));
  await Bun.write(statePath, JSON.stringify(runtime, null, 2));
}

export async function loadCronRuntime(
  jobTitle: string,
  controlBaseDir: string = DEFAULT_BASE_DIR,
): Promise<CronRuntime | null> {
  const statePath = cronRuntimeStatePath(jobTitle, controlBaseDir);
  const file = Bun.file(statePath);
  if (!(await file.exists())) {
    return null;
  }

  try {
    const parsed = JSON.parse(await file.text());
    if (!isCronRuntime(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function clearCronRuntime(
  jobTitle: string,
  controlBaseDir: string = DEFAULT_BASE_DIR,
): Promise<void> {
  const statePath = cronRuntimeStatePath(jobTitle, controlBaseDir);
  await rm(statePath, { force: true });
}

export async function loadCronRuntimeState(
  jobTitle: string,
  controlBaseDir: string = DEFAULT_BASE_DIR,
): Promise<CronRuntimeState> {
  const statePath = cronRuntimeStatePath(jobTitle, controlBaseDir);
  const file = Bun.file(statePath);
  if (!(await file.exists())) {
    return { status: "missing", runtime: null };
  }

  try {
    const parsed = JSON.parse(await file.text());
    if (!isCronRuntime(parsed)) {
      return { status: "invalid", runtime: null };
    }
    return { status: "ok", runtime: parsed };
  } catch {
    return { status: "invalid", runtime: null };
  }
}

export async function resolveCronPaths(
  jobTitle: string,
  controlBaseDir: string = DEFAULT_BASE_DIR,
): Promise<ResolvedPaths> {
  const state = await loadCronRuntimeState(jobTitle, controlBaseDir);
  if (state.status === "ok") {
    return pathsFromRuntime(state.runtime);
  }

  throw new Error(
    state.status === "missing"
      ? "Cron runtime state is missing"
      : "Cron runtime state is invalid",
  );
}

function isCronRuntime(value: unknown): value is CronRuntime {
  if (!value || typeof value !== "object") {
    return false;
  }

  const runtime = value as Partial<CronRuntime>;
  return (
    typeof runtime.baseDir === "string" &&
    typeof runtime.config === "string" &&
    typeof runtime.db === "string" &&
    typeof runtime.hooksDir === "string" &&
    typeof runtime.hooksEnabled === "boolean" &&
    typeof runtime.heartbeatSchedule === "string" &&
    Array.isArray(runtime.jobs) &&
    runtime.jobs.every(isScheduledJobSpec)
  );
}

function isScheduledJobSpec(value: unknown): value is ScheduledJobSpec {
  if (!value || typeof value !== "object") {
    return false;
  }

  const job = value as Partial<ScheduledJobSpec>;
  return (
    typeof job.id === "string" &&
    typeof job.workspaceId === "string" &&
    typeof job.pipelineId === "string" &&
    (job.purpose === "scan" || job.purpose === "batch") &&
    typeof job.enabled === "boolean" &&
    isScheduleSpec(job.schedule)
  );
}

function isScheduleSpec(value: unknown): value is ScheduledJobSpec["schedule"] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const schedule = value as ScheduledJobSpec["schedule"];
  if (schedule.kind === "interval") {
    return typeof schedule.every === "string";
  }
  if (schedule.kind === "cron") {
    return typeof schedule.expression === "string"
      && (schedule.timeZone === undefined || typeof schedule.timeZone === "string");
  }
  return false;
}
