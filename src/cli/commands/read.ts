import type { ParsedArgs } from "../args.ts";
import { UsageError } from "../args.ts";
import { output } from "../output.ts";
import { resolvePaths, ensureDir } from "../../paths.ts";
import { FeedDatabase } from "../../db/index.ts";

export async function readCommand(args: ParsedArgs): Promise<void> {
  const id = args.positionals[0];
  if (!id) throw new UsageError("Usage: feeds read <id>");

  const paths = resolvePaths(args.flags);
  await ensureDir(paths.base);

  using db = new FeedDatabase(paths.db);
  const article = db.getArticleByOccurrenceId(id);
  if (!article) throw new Error(`Article not found: ${id}`);

  const content = article.canonicalId
    ? db.getArticleContent(article.canonicalId)
    : null;

  db.markArticleRead(article.id);

  const result = { ...article, content: content ?? article.content };

  output(result, args.flags.format, (a) => {
    const lines: string[] = [];
    lines.push(a.title);
    lines.push("─".repeat(60));
    if (a.publishedAt) lines.push(`Date:  ${a.publishedAt}`);
    lines.push(`URL:   ${a.url}`);
    if (a.authors.length > 0)
      lines.push(`By:    ${a.authors.map((au) => au.name).join(", ")}`);
    if (a.tags.length > 0) lines.push(`Tags:  ${a.tags.join(", ")}`);
    lines.push("");
    if (a.content) {
      lines.push(stripHtml(a.content));
    } else if (a.summary) {
      lines.push(stripHtml(a.summary));
    } else {
      lines.push("(no content)");
    }
    return lines.join("\n");
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&ndash;/g, "\u2013")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
