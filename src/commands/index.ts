import { addFeedToConfig, ensureParentDir, getDefaultConfigPath, getDefaultDbPath, loadConfig, removeFeedFromConfig } from "../config";
import { FeedDatabase } from "../db";
import { scanFeeds } from "../feed";
import type { CliDeps, ConfigFile, FeedDefinition, OutputFormat } from "../types";
import { parseDurationToIso, parseTags, printArticlesHuman, printFeedsHuman, printJson, printScanSummary, requireArg } from "./helpers";

export interface CommonOptions {
  configPath: string;
  dbPath: string;
  format: OutputFormat;
  quiet: boolean;
}

interface CommandOptions {
  positional: string[];
  scrapeSelector?: string;
  tags?: string;
  feed?: string;
  since?: string;
  limit?: string;
  yes?: boolean;
  unread?: boolean;
}

export async function runCommand(argv: string[], deps: CliDeps): Promise<number> {
  const stripped = argv[0] === "feeds" ? argv.slice(1) : argv;
  const { common, args } = parseCommonOptions(stripped);
  const [command, ...rest] = args;

  if (!command || command === "help" || command === "--help") {
    deps.stdout(helpText());
    return 0;
  }

  await ensureParentDir(common.configPath);
  await ensureParentDir(common.dbPath);

  switch (command) {
    case "add":
      return handleAdd(rest, common, deps);
    case "remove":
      return handleRemove(rest, common, deps);
    case "list-feeds":
      return handleListFeeds(common, deps);
    case "scan":
      return handleScan(rest, common, deps);
    case "list":
      return handleList(rest, common, deps);
    case "read":
      return handleRead(rest, common, deps);
    case "read-all":
      return handleReadAll(rest, common, deps);
    default:
      deps.stderr(`unknown command: ${command}`);
      return 1;
  }
}

async function handleAdd(args: string[], common: CommonOptions, deps: CliDeps): Promise<number> {
  const options = parseCommandOptions(args);
  const feed: FeedDefinition = {
    name: requireArg(options.positional[0], "name"),
    url: requireArg(options.positional[1], "url"),
    tags: parseTags(options.tags),
    scrape: options.scrapeSelector ? { selector: options.scrapeSelector } : undefined,
  };

  await addFeedToConfig(common.configPath, feed);

  const db = new FeedDatabase(common.dbPath);
  try {
    db.upsertFeedDefinition(feed);
  } finally {
    db.close();
  }

  if (!common.quiet) {
    deps.stdout(`Added feed "${feed.name}".`);
  }
  return 0;
}

async function handleRemove(args: string[], common: CommonOptions, deps: CliDeps): Promise<number> {
  const options = parseCommandOptions(args);
  if (!options.yes) {
    deps.stderr("remove requires -y to run non-interactively");
    return 1;
  }

  const name = requireArg(options.positional[0], "name");
  await removeFeedFromConfig(common.configPath, name);

  const db = new FeedDatabase(common.dbPath);
  try {
    db.removeFeed(name);
  } finally {
    db.close();
  }

  if (!common.quiet) {
    deps.stdout(`Removed feed "${name}".`);
  }
  return 0;
}

async function handleListFeeds(common: CommonOptions, deps: CliDeps): Promise<number> {
  const config = await loadConfig(common.configPath);
  const db = new FeedDatabase(common.dbPath);
  try {
    syncFeedsToDb(db, config);
    const stateMap = new Map(db.listFeedStates().map((state) => [state.name, state]));
    const feeds = config.feeds.map((feed) => ({ ...feed, ...stateMap.get(feed.name) }));
    if (common.format === "json") {
      printJson(deps, feeds);
    } else {
      printFeedsHuman(deps, feeds);
    }
    return 0;
  } finally {
    db.close();
  }
}

async function handleScan(args: string[], common: CommonOptions, deps: CliDeps): Promise<number> {
  const options = parseCommandOptions(args);
  const config = await loadConfig(common.configPath);
  const targets = options.feed ? config.feeds.filter((feed) => feed.name === options.feed) : config.feeds;
  if (targets.length === 0) {
    deps.stderr(options.feed ? `feed "${options.feed}" not found` : "no feeds configured");
    return 1;
  }

  const db = new FeedDatabase(common.dbPath);
  try {
    syncFeedsToDb(db, config);
    const summary = await scanFeeds(db, targets, deps.fetchImpl, deps.now);
    if (!common.quiet) {
      printScanSummary(deps, summary, common.format);
    }
    return summary.totals.errors > 0 ? 1 : 0;
  } finally {
    db.close();
  }
}

async function handleList(args: string[], common: CommonOptions, deps: CliDeps): Promise<number> {
  const options = parseCommandOptions(args);
  const db = new FeedDatabase(common.dbPath);
  try {
    const limit = options.limit ? Number.parseInt(options.limit, 10) : undefined;
    if (options.limit && Number.isNaN(limit)) {
      throw new Error(`invalid limit: ${options.limit}`);
    }
    const articles = db.listArticles({
      unread: options.unread,
      feed: options.feed,
      since: options.since ? parseDurationToIso(options.since, deps.now()) : undefined,
      limit,
    });

    if (common.format === "json") {
      printJson(deps, articles);
    } else {
      printArticlesHuman(deps, articles);
    }
    return 0;
  } finally {
    db.close();
  }
}

async function handleRead(args: string[], common: CommonOptions, deps: CliDeps): Promise<number> {
  const options = parseCommandOptions(args);
  const id = requireArg(options.positional[0], "id");

  const db = new FeedDatabase(common.dbPath);
  try {
    if (!db.markArticleRead(id)) {
      deps.stderr(`article "${id}" not found`);
      return 1;
    }
  } finally {
    db.close();
  }

  if (!common.quiet) {
    deps.stdout(`Marked "${id}" as read.`);
  }
  return 0;
}

async function handleReadAll(args: string[], common: CommonOptions, deps: CliDeps): Promise<number> {
  const options = parseCommandOptions(args);
  const db = new FeedDatabase(common.dbPath);
  const count = db.markAllRead(options.feed);
  db.close();

  if (!common.quiet) {
    deps.stdout(`Marked ${count} article(s) as read.`);
  }
  return 0;
}

function parseCommonOptions(argv: string[]): { common: CommonOptions; args: string[] } {
  const common: CommonOptions = {
    configPath: getDefaultConfigPath(),
    dbPath: getDefaultDbPath(),
    format: "human",
    quiet: false,
  };
  const args: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }
    switch (token) {
      case "--config":
        common.configPath = requireArg(argv[index + 1], "--config");
        index += 1;
        break;
      case "--db":
        common.dbPath = requireArg(argv[index + 1], "--db");
        index += 1;
        break;
      case "--format":
        if (argv[index + 1] !== "json") {
          throw new Error(`unsupported format: ${argv[index + 1] ?? ""}`);
        }
        common.format = "json";
        index += 1;
        break;
      case "--quiet":
      case "-q":
        common.quiet = true;
        break;
      default:
        args.push(token);
    }
  }

  return { common, args };
}

function parseCommandOptions(argv: string[]): CommandOptions {
  const options: CommandOptions = { positional: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }
    if (!token.startsWith("-")) {
      options.positional.push(token);
      continue;
    }

    switch (token) {
      case "--scrape-selector":
        options.scrapeSelector = requireArg(argv[index + 1], token);
        index += 1;
        break;
      case "--tags":
        options.tags = requireArg(argv[index + 1], token);
        index += 1;
        break;
      case "--feed":
        options.feed = requireArg(argv[index + 1], token);
        index += 1;
        break;
      case "--since":
        options.since = requireArg(argv[index + 1], token);
        index += 1;
        break;
      case "--limit":
        options.limit = requireArg(argv[index + 1], token);
        index += 1;
        break;
      case "-y":
        options.yes = true;
        break;
      case "--unread":
        options.unread = true;
        break;
      default:
        throw new Error(`unknown option: ${token}`);
    }
  }

  return options;
}

function syncFeedsToDb(db: FeedDatabase, config: ConfigFile): void {
  for (const feed of config.feeds) {
    db.upsertFeedDefinition(feed);
  }
}

function helpText(): string {
  return [
    "feeds-cli v0.1",
    "",
    "Commands:",
    "  add <name> <url> [--scrape-selector <css>] [--tags <t1,t2>]",
    "  remove <name> [-y]",
    "  list-feeds [--format json]",
    "  scan [--feed <name>] [--format json]",
    "  list [--unread] [--feed <name>] [--since <duration>] [--limit <n>] [--format json]",
    "  read <id>",
    "  read-all [--feed <name>]",
  ].join("\n");
}
