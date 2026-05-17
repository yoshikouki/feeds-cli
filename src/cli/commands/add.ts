import type { ParsedArgs } from "../args.ts";
import { UsageError } from "../args.ts";
import { CliError } from "../diagnostic.ts";
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
  if (!url) {
    throw new UsageError("Usage: feeds add <url> [--name NAME] [--no-seed]", {
      code: "usage.missing_argument",
      reason: "The add command needs a feed URL.",
      suggestedAction: "Pass an http or https feed URL.",
      context: { command: "add", argument: "url" },
    });
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new UsageError(`Unsupported URL scheme: ${parsed.protocol}`, {
        code: "usage.unsupported_url_scheme",
        reason: "feeds-cli can only fetch feeds over http or https.",
        suggestedAction: "Use an http:// or https:// URL.",
        context: { url, scheme: parsed.protocol },
      });
    }
  } catch (e) {
    if (e instanceof UsageError) throw e;
    throw new UsageError(`Invalid URL: ${url}`, {
      code: "usage.invalid_url",
      reason: "The provided value could not be parsed as a URL.",
      suggestedAction: "Pass a valid http:// or https:// URL.",
      context: { url },
    });
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
    throw new CliError(`Could not detect feed format from ${url}`, {
      code: "parser.unsupported_format",
      category: "parser",
      reason: "The fetched content did not match a supported feed format.",
      suggestedAction: "Check the URL and make sure it points to RSS, Atom, JSON Feed, or Sitemap content.",
      context: { url },
    });
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
    throw new CliError(`Feed "${feedDef.name}" already exists`, {
      code: "config.feed_already_exists",
      category: "config",
      reason: "A feed with the derived or provided name is already registered.",
      suggestedAction: "Choose a different name with --name or remove the existing feed first.",
      context: { feedName: feedDef.name, config: paths.config },
    });
  }

  using db = new FeedDatabase(paths.db);
  const state = db.upsertFeedFromConfig(feedDef);

  config.feeds.push(feedDef);
  await saveConfig(paths.config, config);

  if (!args.flags.noSeed) {
    const result = await deps.scanFeed(db, feedDef);
    if (result.errors.length > 0) {
      throw new CliError(`Seed failed: ${result.errors.join("; ")}`, {
        code: "runtime.seed_failed",
        category: "runtime",
        reason: "The feed was registered, but the initial scan reported one or more errors.",
        suggestedAction: "Inspect the seed error, fix the source if needed, then run 'feeds scan <name>'.",
        context: { feedName: feedDef.name },
      });
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
    throw new UsageError("--sitemap-include/--sitemap-exclude can only be used with sitemap sources", {
      code: "usage.invalid_option_combination",
      reason: "Sitemap URL filters only apply when the source is detected as a sitemap.",
      suggestedAction: "Use these flags with a sitemap URL, or omit them for RSS, Atom, and JSON Feed sources.",
      context: { kind },
    });
  }

  for (const pattern of [...include, ...exclude]) {
    try {
      new RegExp(pattern);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new UsageError(`Invalid sitemap regex "${pattern}": ${message}`, {
        code: "usage.invalid_pattern",
        reason: "The sitemap filter pattern is not a valid regular expression.",
        suggestedAction: "Fix the pattern passed to --sitemap-include or --sitemap-exclude.",
        context: { pattern },
      });
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
