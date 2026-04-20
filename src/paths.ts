import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

export const DEFAULT_BASE_DIR = join(homedir(), ".feeds-cli");

export interface ResolvedPaths {
  base: string;
  config: string;
  db: string;
  hooksDir: string;
  hooksEnabled: boolean;
}

/**
 * All files live under ~/.feeds-cli/.
 * CLI flags --base-dir / --config / --db override default path resolution.
 */
export function resolvePaths(flags?: {
  baseDir?: string;
  config?: string;
  db?: string;
  noHooks?: boolean;
}): ResolvedPaths {
  const base = flags?.baseDir ?? DEFAULT_BASE_DIR;
  return {
    base,
    config: flags?.config ?? join(base, "feeds.json5"),
    db: flags?.db ?? join(base, "feeds.db"),
    hooksDir: join(base, "hooks", "cron"),
    hooksEnabled: !flags?.noHooks,
  };
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}
