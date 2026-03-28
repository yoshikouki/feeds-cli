import type { ParsedArgs } from "../args.ts";
import { output, formatDate } from "../output.ts";
import { resolvePaths, ensureDir } from "../../paths.ts";
import { FeedDatabase } from "../../db/index.ts";
import type { Article } from "../../types.ts";

export async function listCommand(args: ParsedArgs): Promise<void> {
  const paths = resolvePaths(args.flags);
  await ensureDir(paths.dataDir);

  using db = new FeedDatabase(paths.db);
  const articles = db.listArticles({
    feedName: args.positionals[0],
    unread: args.flags.unread || undefined,
    limit: args.flags.limit,
    search: args.flags.search,
    since: args.flags.since,
    tag: args.flags.tag,
  });

  output(articles, args.flags.format, (data) => {
    const items = data as Article[];
    if (items.length === 0) return "No articles found.";

    return items
      .map((a) => {
        const marker = a.read ? " " : "●";
        const date = formatDate(a.publishedAt ?? a.discoveredAt);
        return `${marker} ${date}  ${a.title}\n  ${a.url}`;
      })
      .join("\n\n");
  });
}
