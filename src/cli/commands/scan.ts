import type { ParsedArgs } from "../args.ts";
import { UsageError } from "../args.ts";
import { output } from "../output.ts";
import { resolvePaths, ensureDir } from "../../paths.ts";
import { loadConfig } from "../../config/index.ts";
import { FeedDatabase } from "../../db/index.ts";
import { scanFeed, type ScanResult } from "../../scanner.ts";

export async function scanCommand(args: ParsedArgs): Promise<void> {
  const feedName = args.positionals[0];
  if (!feedName && !args.flags.all) {
    throw new UsageError("Usage: feeds scan <name> or feeds scan --all");
  }

  const paths = resolvePaths(args.flags);
  await ensureDir(paths.base);

  const config = await loadConfig(paths.config);
  if (config.feeds.length === 0) {
    throw new Error("No feeds in config. Use 'feeds add <url>' first.");
  }

  const feedDefs = feedName
    ? config.feeds.filter((f) => f.name === feedName)
    : config.feeds;

  if (feedDefs.length === 0) {
    throw new Error(`Feed not found in config: ${feedName}`);
  }

  using db = new FeedDatabase(paths.db);
  const results: ScanResult[] = [];

  for (const feedDef of feedDefs) {
    const result = await scanFeed(db, feedDef);
    results.push(result);
  }

  output(results, args.flags.format, (data) => {
    return data
      .map((r) => {
        const parts = [
          `${r.feedName}: ${r.articlesInserted} new / ${r.articlesFound} found (${r.sourcesScanned} sources)`,
        ];
        for (const err of r.errors) {
          parts.push(`  error: ${err}`);
        }
        return parts.join("\n");
      })
      .join("\n");
  });
}
