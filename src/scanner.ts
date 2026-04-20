import { outputInfo, outputWarn } from "./cli/output.ts";
import type { FeedDatabase } from "./db/index.ts";
import { fetchAndParseFeedSource } from "./parser/index.ts";
import type {
  FeedDefinition,
  InsertArticleInput,
  ParsedArticle,
} from "./types.ts";

export interface ScanResult {
  feedName: string;
  feedId: string;
  sourcesScanned: number;
  articlesFound: number;
  articlesInserted: number;
  errors: string[];
  newArticles: NewArticle[];
}

export interface NewArticle {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  feedName: string;
  summary: string | null;
}

export async function scanFeed(
  db: FeedDatabase,
  feedDef: FeedDefinition,
  cycleId?: string,
): Promise<ScanResult> {
  const feedState = db.upsertFeedFromConfig(feedDef);
  const dbSources = db.listFeedSources(feedState.id);
  const result: ScanResult = {
    feedName: feedDef.name,
    feedId: feedState.id,
    sourcesScanned: 0,
    articlesFound: 0,
    articlesInserted: 0,
    errors: [],
    newArticles: [],
  };

  for (const sourceDef of feedDef.sources) {
    const dbSource = dbSources.find((s) => s.id === sourceDef.id);
    if (!dbSource) {
      result.errors.push(
        `Source "${sourceDef.name ?? sourceDef.url}" has no matching DB row`,
      );
      continue;
    }

    outputInfo(`Scanning: ${sourceDef.name ?? sourceDef.url}`);
    const startTime = performance.now();
    const scannedAt = new Date().toISOString();

    const { articles, warnings, error } =
      await fetchAndParseFeedSource(sourceDef);
    const durationMs = Math.round(performance.now() - startTime);

    for (const w of warnings) outputWarn(w);

    result.sourcesScanned++;

    if (error) {
      result.errors.push(`${sourceDef.name}: ${error}`);
      db.markSourceScanError(dbSource.id, scannedAt, error, durationMs, cycleId);
      continue;
    }

    result.articlesFound += articles.length;

    for (const article of articles) {
      const input = toInsertInput(
        article,
        feedState.id,
        dbSource.id,
        dbSource.tags,
      );
      const { inserted, id } = db.insertArticle(input);
      if (inserted) {
        if (!id) {
          throw new Error("insertArticle returned no id for a newly inserted article");
        }

        result.articlesInserted++;
        result.newArticles.push({
          id,
          title: article.title,
          url: article.url,
          publishedAt: article.publishedAt,
          feedName: feedDef.name,
          summary: article.summary,
        });
      }
    }

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
      cycleId,
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
