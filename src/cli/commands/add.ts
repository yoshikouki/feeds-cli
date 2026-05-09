import type { ParsedArgs } from "../args.ts";
import { UsageError } from "../args.ts";
import { output, outputInfo, outputWarn } from "../output.ts";
import { resolvePaths, ensureDir } from "../../paths.ts";
import { loadConfig, saveConfig, normalizeFeedDefinition } from "../../config/index.ts";
import { FeedDatabase } from "../../db/index.ts";
import { fetchFeed, detectFeedFormat } from "../../parser/index.ts";
import { scanFeed } from "../../scanner.ts";
import {
  cronStart,
  cronStatus,
  cronStop,
  type CronStatus,
} from "../../cron/index.ts";
import { pathsFromRuntime } from "../../cron/runtime.ts";
import type { FeedDefinition, FeedSourceDefinition, SourceKind } from "../../types.ts";

type AddCommandDeps = {
  cronStatus: typeof cronStatus;
  cronStop: typeof cronStop;
  cronStart: typeof cronStart;
  fetchFeed: typeof fetchFeed;
  scanFeed: typeof scanFeed;
};

const defaultDeps: AddCommandDeps = {
  cronStatus,
  cronStop,
  cronStart,
  fetchFeed,
  scanFeed,
};

export async function addCommand(
  args: ParsedArgs,
  deps: AddCommandDeps = defaultDeps,
): Promise<void> {
  const url = args.positionals[0];
  if (!url) throw new UsageError("Usage: feeds add <url> [--name NAME] [--no-seed]");

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new UsageError(`Unsupported URL scheme: ${parsed.protocol}`);
    }
  } catch (e) {
    if (e instanceof UsageError) throw e;
    throw new UsageError(`Invalid URL: ${url}`);
  }

  const paths = resolvePaths(args.flags);
  await ensureDir(paths.base);

  const cronBeforeAdd = await inspectCronBeforeAdd(paths.base, deps);

  if (cronBeforeAdd.registered) {
    await deps.cronStop(paths.base);
  }

  let commandError: unknown = null;
  try {
    await addFeedAndMaybeSeed(url, args, paths, deps);
  } catch (err) {
    commandError = err;
    throw err;
  } finally {
    if (cronBeforeAdd.registered) {
      await restoreCronAfterAdd(cronBeforeAdd, deps, commandError);
    }
  }
}

type AddPaths = ReturnType<typeof resolvePaths>;

async function addFeedAndMaybeSeed(
  url: string,
  args: ParsedArgs,
  paths: AddPaths,
  deps: AddCommandDeps,
): Promise<void> {
  outputInfo(`Fetching ${url} ...`);
  const raw = await deps.fetchFeed(url);
  let kind: SourceKind;
  try {
    kind = detectFeedFormat(raw);
  } catch {
    throw new Error(`Could not detect feed format from ${url}`);
  }

  const name = args.flags.name ?? deriveNameFromUrl(url);
  const sitemap = sitemapConfigFromFlags(args, kind);
  const source: FeedSourceDefinition = { name, kind, url };
  if (sitemap) {
    source.sitemap = sitemap;
  }

  const feedDef: FeedDefinition = normalizeFeedDefinition({
    name,
    sources: [source],
  });

  const config = await loadConfig(paths.config);
  if (config.feeds.some((f) => f.name === feedDef.name)) {
    throw new Error(`Feed "${feedDef.name}" already exists`);
  }

  using db = new FeedDatabase(paths.db);
  const state = db.upsertFeedFromConfig(feedDef);

  config.feeds.push(feedDef);
  await saveConfig(paths.config, config);

  if (!args.flags.noSeed) {
    const result = await deps.scanFeed(db, feedDef);
    if (result.errors.length > 0) {
      throw new Error(`Seed failed: ${result.errors.join("; ")}`);
    }
    outputInfo(
      `Seeded ${result.articlesInserted} existing articles from ${result.articlesFound} found.`,
    );
  }

  output(state, args.flags.format, () => `Added feed: ${name} (${kind}, ${url})`);
}

type CronBeforeAdd =
  | { registered: false }
  | {
      registered: true;
      restore:
        | { safe: true; every: string; paths: AddPaths }
        | { safe: false; reason: string };
    };

async function inspectCronBeforeAdd(
  baseDir: string,
  deps: AddCommandDeps,
): Promise<CronBeforeAdd> {
  const status = await deps.cronStatus(baseDir);
  return cronRestorePlan(status);
}

export function cronRestorePlan(status: CronStatus): CronBeforeAdd {
  if (!status.registered) {
    return { registered: false };
  }

  if (status.runtimeState !== "ok" || !status.runtime) {
    return {
      registered: true,
      restore: {
        safe: false,
        reason: `cron runtime state is ${status.runtimeState ?? "unknown"}`,
      },
    };
  }

  if (status.runtime.jobs.length !== 1) {
    return {
      registered: true,
      restore: {
        safe: false,
        reason: `expected one scan job, found ${status.runtime.jobs.length}`,
      },
    };
  }

  const job = status.runtime.jobs[0]!;
  if (job.purpose !== "scan" || !job.enabled || job.schedule.kind !== "interval") {
    return {
      registered: true,
      restore: {
        safe: false,
        reason: "cron job is not a single enabled interval scan job",
      },
    };
  }

  return {
    registered: true,
    restore: {
      safe: true,
      every: job.schedule.every,
      paths: pathsFromRuntime(status.runtime),
    },
  };
}

async function restoreCronAfterAdd(
  cronBeforeAdd: CronBeforeAdd,
  deps: AddCommandDeps,
  commandError: unknown,
): Promise<void> {
  if (!cronBeforeAdd.registered) {
    return;
  }

  if (!cronBeforeAdd.restore.safe) {
    outputWarn(
      `Cron was stopped before add and was not restarted: ${cronBeforeAdd.restore.reason}. Run 'feeds cron repair' or 'feeds cron start' after checking the workspace.`,
    );
    return;
  }

  try {
    await deps.cronStart(cronBeforeAdd.restore.every, cronBeforeAdd.restore.paths);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputWarn(`Cron was stopped before add but could not be restarted: ${message}`);
    if (commandError === null) {
      throw err;
    }
  }
}

function sitemapConfigFromFlags(
  args: ParsedArgs,
  kind: SourceKind,
): FeedSourceDefinition["sitemap"] | undefined {
  const include = args.flags.sitemapInclude ?? [];
  const exclude = args.flags.sitemapExclude ?? [];
  if (include.length === 0 && exclude.length === 0) {
    return undefined;
  }

  if (kind !== "sitemap") {
    throw new UsageError("--sitemap-include/--sitemap-exclude can only be used with sitemap sources");
  }

  for (const pattern of [...include, ...exclude]) {
    try {
      new RegExp(pattern);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new UsageError(`Invalid sitemap regex "${pattern}": ${message}`);
    }
  }

  return {
    include: include.length > 0 ? include : undefined,
    exclude: exclude.length > 0 ? exclude : undefined,
  };
}

function deriveNameFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
