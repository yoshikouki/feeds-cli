import type { ParsedArgs } from "../args.ts";
import { output, formatTable, formatDate } from "../output.ts";
import { resolvePaths, ensureDir } from "../../paths.ts";
import { FeedDatabase } from "../../db/index.ts";

export async function feedsCommand(args: ParsedArgs): Promise<void> {
  const paths = resolvePaths(args.flags);
  await ensureDir(paths.dataDir);

  using db = new FeedDatabase(paths.db);
  const states = db.listFeedStates();

  output(states, args.flags.format, (data) => {
    const feeds = data as typeof states;
    if (feeds.length === 0) return "No feeds registered. Use 'feeds add <url>' to get started.";

    return formatTable(
      ["NAME", "STATUS", "SOURCES", "LAST SCAN", "ERRORS"],
      feeds.map((f) => [
        f.name,
        f.status,
        String(f.sourceCount),
        formatDate(f.lastScannedAt),
        String(f.errorCount),
      ]),
    );
  });
}
