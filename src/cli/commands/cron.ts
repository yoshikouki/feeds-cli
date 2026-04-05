import type { ParsedArgs } from "../args.ts";
import { UsageError } from "../args.ts";
import { outputText } from "../output.ts";
import { resolvePaths } from "../../paths.ts";
import {
  intervalToCron,
  runCycle,
  cronStart,
  cronStop,
  cronNextRun,
} from "../../cron/index.ts";

const DEFAULT_INTERVAL = "30m";

const CRON_HELP = `feeds cron — scheduled feed scanning

Usage:
  feeds cron start [--interval 30m]   Register OS cron job
  feeds cron stop                     Remove OS cron job
  feeds cron run                      Run one scan cycle (foreground)`;

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
      await cronStart(schedule);
      const next = cronNextRun(schedule);
      if (next) {
        outputText(`Next run: ${next.toISOString()}`);
      }
      break;
    }
    case "stop":
      await cronStop();
      break;
    case "run": {
      const paths = resolvePaths(args.flags);
      await runCycle(paths);
      break;
    }
    default:
      throw new UsageError(
        `Unknown cron subcommand: ${subcommand}\n${CRON_HELP}`,
      );
  }
}
