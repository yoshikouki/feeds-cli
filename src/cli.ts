#!/usr/bin/env bun

import { parseArgs, UsageError, type ParsedArgs } from "./cli/args.ts";
import { outputError } from "./cli/output.ts";

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
  add <url>          Register a new feed
  scan [name]        Fetch and store articles
  list [name]        List articles
  read <id>          Show article content
  feeds              List registered feeds
  remove <name>      Remove a feed
  cron <sub>         Scheduled scanning (start|stop|status|run)
  log [cycles|scans] Show execution history

Global options:
  --config <path>    Config file path
  --db <path>        Database file path
  --format json      Output as JSON
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
  if (err instanceof UsageError) {
    outputError(err.message);
    process.exit(2);
  }
  outputError(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
