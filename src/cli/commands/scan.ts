import type { ParsedArgs } from "../args.ts";
import { UsageError } from "../args.ts";
import { output, outputInfo, outputWarn } from "../output.ts";
import { resolvePaths, ensureDir } from "../../paths.ts";
import { loadConfig } from "../../config/index.ts";
import { FeedDatabase } from "../../db/index.ts";
import { fetchAndParseFeedSource } from "../../parser/index.ts";
import type {
  FeedDefinition,
  FeedSourceDefinition,
  InsertArticleInput,
  ParsedArticle,
} from "../../types.ts";

interface ScanResult {
  feedName: string;
  sourcesScanned: number;
  articlesFound: number;
  articlesInserted: number;
  errors: string[];
}

export async function scanCommand(args: ParsedArgs): Promise<void> {
  const feedName = args.positionals[0];
  if (!feedName && !args.flags.all) {
    throw new UsageError("Usage: feeds scan <name> or feeds scan --all");
  }

  const paths = resolvePaths(args.flags);
  await ensureDir(paths.dataDir);

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

async function scanFeed(
  db: FeedDatabase,
  feedDef: FeedDefinition,
): Promise<ScanResult> {
  const feedState = db.upsertFeedFromConfig(feedDef);
  const dbSources = db.listFeedSources(feedState.id);
  const result: ScanResult = {
    feedName: feedDef.name,
    sourcesScanned: 0,
    articlesFound: 0,
    articlesInserted: 0,
    errors: [],
  };

  for (const sourceDef of feedDef.sources) {
    const dbSource = dbSources.find((s) => s.id === sourceDef.id);
    if (!dbSource) continue;

    outputInfo(`Scanning: ${sourceDef.name ?? sourceDef.url}`);
    const startTime = performance.now();
    const scannedAt = new Date().toISOString();

    const { articles, warnings, error } = await fetchAndParseFeedSource(sourceDef);
    const durationMs = Math.round(performance.now() - startTime);

    for (const w of warnings) outputWarn(w);

    result.sourcesScanned++;

    if (error) {
      result.errors.push(`${sourceDef.name}: ${error}`);
      db.markSourceScanError(dbSource.id, scannedAt, error, durationMs);
      continue;
    }

    result.articlesFound += articles.length;
    let inserted = 0;

    for (const article of articles) {
      const input = toInsertInput(article, feedState.id, dbSource.id, dbSource.tags);
      const { inserted: wasInserted } = db.insertArticle(input);
      if (wasInserted) inserted++;
    }

    result.articlesInserted += inserted;

    const lastArticleAt = articles.reduce<string | null>((latest, a) => {
      const d = a.publishedAt ?? a.updatedAt;
      return d && (!latest || d > latest) ? d : latest;
    }, null);

    db.markSourceScanSuccess(
      dbSource.id,
      scannedAt,
      lastArticleAt,
      articles.length,
      durationMs,
    );
  }

  return result;
}

function toInsertInput(
  article: ParsedArticle,
  feedId: string,
  feedSourceId: string,
  tags: string[],
): InsertArticleInput {
  return {
    feedId,
    feedSourceId,
    url: article.url,
    externalId: article.externalId,
    title: article.title,
    summary: article.summary,
    content: article.content,
    authors: article.authors,
    categories: article.categories,
    attachments: article.attachments,
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt,
    discoveredAt: new Date().toISOString(),
    language: article.language,
    sourceFormat: article.sourceFormat,
    tags,
  };
}
