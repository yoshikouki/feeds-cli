import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

const DEFAULT_DIR = join(homedir(), "feeds-cli");

export interface ResolvedPaths {
  dir: string;
  config: string;
  db: string;
}

/**
 * Resolve data directory, config path, and db path.
 * Priority: CLI flags > env vars > default ~/feeds-cli/
 */
export function resolvePaths(flags?: {
  config?: string;
  db?: string;
}): ResolvedPaths {
  const dir = process.env.FEEDS_CLI_DIR || DEFAULT_DIR;

  return {
    dir,
    config:
      flags?.config ?? process.env.FEEDS_CLI_CONFIG ?? join(dir, "feeds.json5"),
    db: flags?.db ?? process.env.FEEDS_CLI_DB ?? join(dir, "feeds.db"),
  };
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}
