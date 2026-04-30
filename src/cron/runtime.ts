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

export const CRON_RUNTIME_VERSION = 2;

export interface CronRuntime {
  version: typeof CRON_RUNTIME_VERSION;
  baseDir: string;
  config: string;
  db: string;
  hooksDir: string;
  hooksEnabled: boolean;
  heartbeatSchedule: string;
  jobs: readonly ScheduledJobSpec[];
}

export interface LegacyCronRuntime {
  baseDir: string;
  config: string;
  db: string;
  hooksDir: string;
  hooksEnabled: boolean;
}

export type CronRuntimeState =
  | { status: "ok"; runtime: CronRuntime; legacyRuntime: null }
  | { status: "missing"; runtime: null; legacyRuntime: null }
  | { status: "invalid"; runtime: null; legacyRuntime: null }
  | { status: "outdated"; runtime: null; legacyRuntime: LegacyCronRuntime };

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
    version: CRON_RUNTIME_VERSION,
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

export function pathsFromLegacyRuntime(runtime: LegacyCronRuntime): ResolvedPaths {
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
    if (!isCurrentCronRuntime(parsed)) {
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
    return { status: "missing", runtime: null, legacyRuntime: null };
  }

  try {
    const parsed = JSON.parse(await file.text());
    if (isCurrentCronRuntime(parsed)) {
      return { status: "ok", runtime: parsed, legacyRuntime: null };
    }
    if (isLegacyCronRuntime(parsed)) {
      return { status: "outdated", runtime: null, legacyRuntime: parsed };
    }
    return { status: "invalid", runtime: null, legacyRuntime: null };
  } catch {
    return { status: "invalid", runtime: null, legacyRuntime: null };
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

  throw new Error(cronRuntimeStateError(state));
}

export function cronRuntimeStateError(state: Pick<CronRuntimeState, "status">): string {
  switch (state.status) {
    case "missing":
      return "Cron runtime state is missing";
    case "outdated":
      return "Cron runtime state is outdated and requires repair";
    case "invalid":
      return "Cron runtime state is invalid";
    case "ok":
      return "Cron runtime state is current";
  }
}

export function cronRuntimeStateDisplay(status: CronRuntimeState["status"]): string {
  switch (status) {
    case "outdated":
      return "repair required";
    default:
      return status;
  }
}

function isCurrentCronRuntime(value: unknown): value is CronRuntime {
  if (!value || typeof value !== "object") {
    return false;
  }

  const runtime = value as Partial<CronRuntime>;
  return (
    runtime.version === CRON_RUNTIME_VERSION &&
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

function isLegacyCronRuntime(value: unknown): value is LegacyCronRuntime {
  if (!value || typeof value !== "object") {
    return false;
  }

  const runtime = value as Partial<LegacyCronRuntime & { version?: unknown }>;
  return (
    runtime.version === undefined &&
    typeof runtime.baseDir === "string" &&
    typeof runtime.config === "string" &&
    typeof runtime.db === "string" &&
    typeof runtime.hooksDir === "string" &&
    typeof runtime.hooksEnabled === "boolean"
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
