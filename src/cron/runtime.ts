import { dirname, join } from "node:path";
import { rm } from "node:fs/promises";
import {
  DEFAULT_BASE_DIR,
  ensureDir,
  type ResolvedPaths,
} from "../paths.ts";

export interface CronRuntime {
  baseDir: string;
  config: string;
  db: string;
  hooksDir: string;
  hooksEnabled: boolean;
}

export type CronRuntimeState =
  | { status: "ok"; runtime: CronRuntime }
  | { status: "missing"; runtime: null }
  | { status: "invalid"; runtime: null };

export function cronRuntimeStatePath(baseDir: string = DEFAULT_BASE_DIR): string {
  return join(baseDir, "cron.runtime.json");
}

export function runtimeFromPaths(paths: ResolvedPaths): CronRuntime {
  return {
    baseDir: paths.base,
    config: paths.config,
    db: paths.db,
    hooksDir: paths.hooksDir,
    hooksEnabled: paths.hooksEnabled,
  };
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
  statePath: string = cronRuntimeStatePath(),
): Promise<void> {
  await ensureDir(dirname(statePath));
  await Bun.write(statePath, JSON.stringify(runtime, null, 2));
}

export async function loadCronRuntime(
  statePath: string = cronRuntimeStatePath(),
): Promise<CronRuntime | null> {
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
  statePath: string = cronRuntimeStatePath(),
): Promise<void> {
  await rm(statePath, { force: true });
}

export async function loadCronRuntimeState(
  statePath: string = cronRuntimeStatePath(),
): Promise<CronRuntimeState> {
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
  statePath: string = cronRuntimeStatePath(),
): Promise<ResolvedPaths> {
  const state = await loadCronRuntimeState(statePath);
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
    typeof runtime.hooksEnabled === "boolean"
  );
}
