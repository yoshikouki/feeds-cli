#!/usr/bin/env bun

import { runCommand } from "./commands";
import type { CliDeps } from "./types";

export async function runCli(argv: string[], deps?: Partial<CliDeps>): Promise<number> {
  const runtimeDeps: CliDeps = {
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
    fetchImpl: fetch,
    now: () => new Date(),
    ...deps,
  };

  try {
    return await runCommand(argv, runtimeDeps);
  } catch (error) {
    runtimeDeps.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2));
}
