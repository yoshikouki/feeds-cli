import type { ParsedArgs } from "../args.ts";
import { UsageError } from "../args.ts";
import { output } from "../output.ts";
import { resolvePaths, ensureDir } from "../../paths.ts";
import { removeFeedFromConfig } from "../../config/index.ts";
import { FeedDatabase } from "../../db/index.ts";

export async function removeCommand(args: ParsedArgs): Promise<void> {
  const name = args.positionals[0];
  if (!name) throw new UsageError("Usage: feeds remove <name>");

  const paths = resolvePaths(args.flags);
  await ensureDir(paths.dataDir);

  await removeFeedFromConfig(paths.config, name);

  using db = new FeedDatabase(paths.db);
  db.removeFeed(name);

  output({ name, removed: true }, args.flags.format, () => `Removed feed: ${name}`);
}
