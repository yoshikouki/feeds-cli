import type { ParsedArgs } from "../args.ts";
import { UsageError } from "../args.ts";
import { outputText } from "../output.ts";
import { resolvePaths } from "../../paths.ts";
import {
  parseInterval,
  runCycle,
  daemonStart,
  daemonStop,
  daemonStatus,
} from "../../cron/index.ts";

const DEFAULT_INTERVAL = "30m";

const CRON_HELP = `feeds cron — scheduled feed scanning

Usage:
  feeds cron start [--interval 30m]   Start daemon
  feeds cron stop                     Stop daemon
  feeds cron status                   Show daemon status
  feeds cron run                     Run one scan cycle (foreground)`;

export async function cronCommand(args: ParsedArgs): Promise<void> {
  const subcommand = args.positionals[0];

  if (!subcommand || args.flags.help) {
    outputText(CRON_HELP);
    return;
  }

  const paths = resolvePaths(args.flags);
  const intervalStr = args.flags.interval ?? DEFAULT_INTERVAL;

  switch (subcommand) {
    case "start": {
      const intervalMs = parseInterval(intervalStr);
      await daemonStart(paths, intervalMs);
      break;
    }
    case "stop":
      await daemonStop(paths);
      break;
    case "status": {
      const status = await daemonStatus(paths);
      outputText(status);
      break;
    }
    case "run": {
      await runCycle(paths);
      break;
    }
    default:
      throw new UsageError(
        `Unknown cron subcommand: ${subcommand}\n${CRON_HELP}`,
      );
  }
}
