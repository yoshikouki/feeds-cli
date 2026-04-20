import type { ParsedArgs } from "../args.ts";
import { UsageError } from "../args.ts";
import { output, outputText } from "../output.ts";
import { resolvePaths } from "../../paths.ts";
import {
  intervalToCron,
  runCycle,
  cronStart,
  cronStop,
  cronStatus,
  cronNextRun,
  prepareCyclePaths,
} from "../../cron/index.ts";

const DEFAULT_INTERVAL = "30m";

const CRON_HELP = `feeds cron — scheduled feed scanning

Usage:
  feeds cron start [--interval 30m]   Register OS cron job with current runtime
  feeds cron stop                     Remove OS cron job
  feeds cron status                   Show cron job status and runtime
  feeds cron run                      Run one scan cycle (foreground)

Global options:
  --base-dir <path>                   Base directory for config, db, and hooks
  --config <path>                     Config file path override
  --db <path>                         Database file path override
  --no-hooks                          Disable cron hooks for this run or saved cron runtime`;

export function renderCronStatus(status: Awaited<ReturnType<typeof cronStatus>>): string {
  if (!status.registered) {
    return "feeds cron: not registered";
  }

  const lines = ["feeds cron: registered"];
  if (status.schedule) lines.push(`  schedule:      ${status.schedule}`);
  if (status.nextRun) lines.push(`  next run:      ${status.nextRun.toISOString()}`);
  if (status.runtimeState && status.runtimeState !== "ok") {
    lines.push(`  runtime state: ${status.runtimeState}`);
    lines.push("  runtime:       unavailable");
    return lines.join("\n");
  }
  if (status.runtime) {
    lines.push(`  base dir:      ${status.runtime.baseDir}`);
    lines.push(`  config:        ${status.runtime.config}`);
    lines.push(`  db:            ${status.runtime.db}`);
    lines.push(
      `  hooks:         ${status.runtime.hooksEnabled ? "enabled" : "disabled"}`,
    );
    lines.push(`  hooks dir:     ${status.runtime.hooksDir}`);
  }
  return lines.join("\n");
}

export async function cronCommand(args: ParsedArgs): Promise<void> {
  const subcommand = args.positionals[0];

  if (!subcommand || args.flags.help) {
    outputText(CRON_HELP);
    return;
  }

  switch (subcommand) {
    case "start": {
      const intervalStr = args.flags.interval ?? DEFAULT_INTERVAL;
      const schedule = intervalToCron(intervalStr);
      const paths = resolvePaths(args.flags);
      await cronStart(schedule, paths);
      const next = cronNextRun(schedule);
      if (next) {
        outputText(`Next run: ${next.toISOString()}`);
      }
      break;
    }
    case "stop":
      await cronStop();
      break;
    case "status": {
      const status = await cronStatus();
      output(status, args.flags.format, renderCronStatus);
      break;
    }
    case "run": {
      const paths = resolvePaths(args.flags);
      await prepareCyclePaths(paths);
      await runCycle(paths);
      break;
    }
    default:
      throw new UsageError(
        `Unknown cron subcommand: ${subcommand}\n${CRON_HELP}`,
      );
  }
}
