import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

export interface ResolvedPaths {
  base: string;
  config: string;
  db: string;
  hooksDir: string;
  logFile: string;
  pidFile: string;
}

/**
 * All files live under ~/.feeds-cli/.
 * CLI flags --config / --db override individual file paths.
 */
export function resolvePaths(flags?: {
  config?: string;
  db?: string;
}): ResolvedPaths {
  const base = join(homedir(), ".feeds-cli");
  return {
    base,
    config: flags?.config ?? join(base, "feeds.json5"),
    db: flags?.db ?? join(base, "feeds.db"),
    hooksDir: join(base, "hooks", "cron"),
    logFile: join(base, "logs", "cron.log"),
    pidFile: join(base, "cron.pid"),
  };
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}
