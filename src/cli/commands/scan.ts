import type { ParsedArgs } from "../args.ts";
import { UsageError } from "../args.ts";
import { CliError } from "../diagnostic.ts";
import { output } from "../output.ts";
import { resolvePaths, ensureDir } from "../../paths.ts";
import { loadConfig } from "../../config/index.ts";
import { FeedDatabase } from "../../db/index.ts";
import { scanFeed, type ScanResult } from "../../scanner.ts";
import { runCycle } from "../../cron/index.ts";

export async function scanCommand(args: ParsedArgs): Promise<void> {
  const feedName = args.positionals[0];
  if (!feedName && !args.flags.all) {
    throw new UsageError("Usage: feeds scan <name> or feeds scan --all", {
      code: "usage.missing_argument",
      reason: "The scan command needs a feed name unless --all is provided.",
      suggestedAction: "Pass a feed name or run 'feeds scan --all'.",
      context: { command: "scan", argument: "name" },
    });
  }

  const paths = resolvePaths(args.flags);
  await ensureDir(paths.base);

  // --all: delegate to runCycle for unified cycle_log recording
  if (!feedName) {
    await runCycle(paths, "manual");
    return;
  }

  const config = await loadConfig(paths.config);
  if (config.feeds.length === 0) {
    throw new CliError("No feeds in config.", {
      code: "config.empty",
      category: "config",
      reason: "The current workspace does not have any registered feeds.",
      suggestedAction: "Run 'feeds add <url>' first.",
      context: { config: paths.config },
    });
  }

  const feedDefs = config.feeds.filter((f) => f.name === feedName);
  if (feedDefs.length === 0) {
    throw new CliError(`Feed not found in config: ${feedName}`, {
      code: "config.feed_not_found",
      category: "config",
      reason: "No registered feed matches the requested name.",
      suggestedAction: "Run 'feeds feeds' to list registered feeds, then retry with a valid name.",
      context: { feedName, config: paths.config },
    });
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
