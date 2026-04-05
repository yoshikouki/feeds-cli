import type { ParsedArgs } from "../args.ts";
import { output, formatDate } from "../output.ts";
import { resolvePaths, ensureDir } from "../../paths.ts";
import { FeedDatabase } from "../../db/index.ts";

export async function listCommand(args: ParsedArgs): Promise<void> {
  const paths = resolvePaths(args.flags);
  await ensureDir(paths.base);

  using db = new FeedDatabase(paths.db);
  const articles = db.listArticles({
    feedName: args.positionals[0],
    unread: args.flags.unread ? true : undefined,
    limit: args.flags.limit,
    search: args.flags.search,
    since: args.flags.since,
    tag: args.flags.tag,
  });

  output(articles, args.flags.format, (data) => {
    if (data.length === 0) return "No articles found.";

    return data
      .map((a) => {
        const marker = a.read ? " " : "●";
        const date = formatDate(a.publishedAt ?? a.discoveredAt);
        const shortId = a.id.slice(0, 8);
        return `${marker} ${shortId}  ${date}  ${a.title}\n  ${a.url}`;
      })
      .join("\n\n");
  });
}
