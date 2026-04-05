import { readdir, access, constants } from "node:fs/promises";
import { join } from "node:path";
import { outputInfo, outputWarn } from "../cli/output.ts";

export interface HookContext {
  event: string;
  env: Record<string, string>;
  stdin?: string;
}

/**
 * Discover hook files matching `on-{event}.*` in the hooks directory.
 * Returns executable files sorted by name.
 */
export async function discoverHooks(
  hooksDir: string,
  event: string,
): Promise<string[]> {
  const prefix = `on-${event}.`;
  let entries: string[];
  try {
    entries = await readdir(hooksDir);
  } catch {
    return [];
  }

  const matched: string[] = [];
  for (const entry of entries.sort()) {
    if (!entry.startsWith(prefix)) continue;
    const fullPath = join(hooksDir, entry);
    try {
      await access(fullPath, constants.X_OK);
      matched.push(fullPath);
    } catch {
      outputWarn(`Hook not executable, skipping: ${fullPath}`);
    }
  }
  return matched;
}

/**
 * Run all hooks for a given event.
 * Non-zero exits produce a warning but don't throw.
 */
export async function runHooks(
  hooksDir: string,
  context: HookContext,
): Promise<void> {
  const hooks = await discoverHooks(hooksDir, context.event);
  if (hooks.length === 0) return;

  for (const hookPath of hooks) {
    outputInfo(`Running hook: ${hookPath}`);
    try {
      const proc = Bun.spawn([hookPath], {
        env: { ...process.env, ...context.env },
        stdin: context.stdin ? new Blob([context.stdin]) : "ignore",
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        outputWarn(`Hook exited with code ${exitCode}: ${hookPath}`);
      }
    } catch (err) {
      outputWarn(
        `Hook failed: ${hookPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
