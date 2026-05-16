#!/usr/bin/env bun

import { parseArgs, UsageError, type ParsedArgs } from "./cli/args.ts";
import { outputCliError } from "./cli/output.ts";

import { addCommand } from "./cli/commands/add.ts";
import { feedsCommand } from "./cli/commands/feeds.ts";
import { listCommand } from "./cli/commands/list.ts";
import { readCommand } from "./cli/commands/read.ts";
import { cronCommand } from "./cli/commands/cron.ts";
import { logCommand } from "./cli/commands/log.ts";
import { removeCommand } from "./cli/commands/remove.ts";
import { scanCommand } from "./cli/commands/scan.ts";

type CommandFn = (args: ParsedArgs) => Promise<void>;

const COMMANDS: Record<string, CommandFn> = {
  add: addCommand,
  scan: scanCommand,
  list: listCommand,
  read: readCommand,
  feeds: feedsCommand,
  remove: removeCommand,
  cron: cronCommand,
  log: logCommand,
};

const HELP = `feeds-cli — UNIX-philosophy feed reader

Usage: feeds <command> [options]

Commands:
  add <url>          Register a new feed and seed existing entries
  scan <name>|--all  Fetch and store articles
  list [name]        List articles
  read <id>          Show article content
  feeds              List registered feeds
  remove <name>      Remove a feed
  cron <sub>         Scheduled scanning (start|stop|status|repair|check|run)
  log [cycles|scans] Show execution history

Global options:
  --base-dir <path>  Base directory for config, db, and hooks
  --config <path>    Config file path
  --db <path>        Database file path
  --no-hooks         Disable cron hooks for this run or saved cron runtime
  --no-seed          Skip feed seeding during add
  --json             Output as JSON
  --format json      Output as JSON (same as --json)
  -h, --help         Show help
  -v, --version      Show version`;

async function main() {
  const args = parseArgs(process.argv);

  if (args.flags.version) {
    const pkg = await import("../package.json");
    console.log(pkg.version);
    return;
  }

  if (args.flags.help || !args.command) {
    console.log(HELP);
    return;
  }

  const command = COMMANDS[args.command];
  if (!command) {
    throw new UsageError(`Unknown command: ${args.command}\nRun 'feeds --help' for usage.`);
  }

  await command(args);
}

main().catch((err) => {
  const exitCode = err instanceof UsageError ? 2 : 1;
  const format = errorFormatFromArgv(process.argv);
  outputCliError(err, format, exitCode);
  process.exit(exitCode);
});

function errorFormatFromArgv(argv: string[]): ParsedArgs["flags"]["format"] {
  const raw = argv.slice(2);

  for (let i = 0; i < raw.length; i++) {
    const token = raw[i];
    if (token === "--json") {
      return "json";
    }
    if ((token === "--format" || token === "-f") && raw[i + 1] === "json") {
      return "json";
    }
  }

  return "human";
}
