import type { ParsedArgs } from "../args.ts";
import { UsageError } from "../args.ts";
import { CliError } from "../diagnostic.ts";
import { output } from "../output.ts";
import { resolvePaths, ensureDir } from "../../paths.ts";
import { removeFeedFromConfig } from "../../config/index.ts";
import { FeedDatabase } from "../../db/index.ts";

export async function removeCommand(args: ParsedArgs): Promise<void> {
  const name = args.positionals[0];
  if (!name) {
    throw new UsageError("Usage: feeds remove <name>", {
      code: "usage.missing_argument",
      reason: "The remove command needs a feed name.",
      suggestedAction: "Run 'feeds feeds' to list registered feeds, then pass the feed name.",
      context: { command: "remove", argument: "name" },
    });
  }

  const paths = resolvePaths(args.flags);
  await ensureDir(paths.base);

  using db = new FeedDatabase(paths.db);
  db.removeFeed(name);

  try {
    await removeFeedFromConfig(paths.config, name);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === `feed "${name}" not found`) {
      throw new CliError(`Feed not found in config: ${name}`, {
        code: "config.feed_not_found",
        category: "config",
        reason: "No registered feed matches the requested name.",
        suggestedAction: "Run 'feeds feeds' to list registered feeds, then retry with a valid name.",
        context: { feedName: name, config: paths.config },
      });
    }
    throw err;
  }

  output({ name, removed: true }, args.flags.format, () => `Removed feed: ${name}`);
}
