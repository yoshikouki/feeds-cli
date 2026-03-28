import type { ParsedArgs } from "../args.ts";
import { UsageError } from "../args.ts";
import { output, outputInfo } from "../output.ts";
import { resolvePaths, ensureDir } from "../../paths.ts";
import { loadConfig, saveConfig, normalizeFeedDefinition } from "../../config/index.ts";
import { FeedDatabase } from "../../db/index.ts";
import { fetchFeed, detectFeedFormat } from "../../parser/index.ts";
import type { FeedDefinition, SourceKind } from "../../types.ts";

export async function addCommand(args: ParsedArgs): Promise<void> {
  const url = args.positionals[0];
  if (!url) throw new UsageError("Usage: feeds add <url> [--name NAME]");

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
  await ensureDir(paths.configDir);
  await ensureDir(paths.dataDir);

  outputInfo(`Fetching ${url} ...`);
  const raw = await fetchFeed(url);
  let kind: SourceKind;
  try {
    kind = detectFeedFormat(raw);
  } catch {
    throw new Error(`Could not detect feed format from ${url}`);
  }

  const name = args.flags.name ?? deriveNameFromUrl(url);

  const feedDef: FeedDefinition = normalizeFeedDefinition({
    name,
    sources: [{ name, kind, url }],
  });

  const config = await loadConfig(paths.config);
  if (config.feeds.some((f) => f.name === feedDef.name)) {
    throw new Error(`Feed "${feedDef.name}" already exists`);
  }

  using db = new FeedDatabase(paths.db);
  const state = db.upsertFeedFromConfig(feedDef);

  config.feeds.push(feedDef);
  await saveConfig(paths.config, config);

  output(state, args.flags.format, () => `Added feed: ${name} (${kind}, ${url})`);
}

function deriveNameFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
