import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

const APP_NAME = "feeds-cli";

export interface ResolvedPaths {
  configDir: string;
  dataDir: string;
  config: string;
  db: string;
}

/**
 * Resolve config and data paths following XDG Base Directory Spec.
 *
 * Config: $XDG_CONFIG_HOME/feeds-cli/ (default ~/.config/feeds-cli/)
 * Data:   $XDG_DATA_HOME/feeds-cli/   (default ~/.local/share/feeds-cli/)
 *
 * Priority: CLI flags > env vars > XDG defaults
 */
export function resolvePaths(flags?: {
  config?: string;
  db?: string;
}): ResolvedPaths {
  const home = homedir();
  const configDir =
    join(process.env.XDG_CONFIG_HOME || join(home, ".config"), APP_NAME);
  const dataDir =
    join(process.env.XDG_DATA_HOME || join(home, ".local", "share"), APP_NAME);

  return {
    configDir,
    dataDir,
    config: flags?.config ?? join(configDir, "feeds.json5"),
    db: flags?.db ?? join(dataDir, "feeds.db"),
  };
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}
