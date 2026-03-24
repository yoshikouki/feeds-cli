import { FeedDatabase } from "../db";
import type { FeedCandidateArticle, FeedDefinition, FetchLike, ScanFeedResult, ScanSummary } from "../types";
import { parseFeedXml } from "./parser";
import { scrapeArticlesFromHtml } from "./scrape";

export async function scanFeeds(
  db: FeedDatabase,
  feeds: FeedDefinition[],
  fetchImpl: FetchLike,
  now: () => Date,
): Promise<ScanSummary> {
  const results: ScanFeedResult[] = [];

  for (const feed of feeds) {
    db.upsertFeedDefinition(feed);
    const scannedAt = now().toISOString();

    try {
      const response = await fetchImpl(feed.url);
      if (!response.ok) {
        throw new Error(`request failed with status ${response.status}`);
      }

      const body = await response.text();
      const candidates = feed.scrape
        ? scrapeArticlesFromHtml(body, feed.url, feed.scrape)
        : parseFeedXml(body);

      let inserted = 0;
      let latestArticleAt: string | null = null;

      for (const article of dedupeCandidates(candidates)) {
        const publishedAt = normalizeTimestamp(article.publishedAt);
        if (publishedAt && (!latestArticleAt || publishedAt > latestArticleAt)) {
          latestArticleAt = publishedAt;
        }

        const result = db.insertArticle({
          feedName: feed.name,
          url: normalizeUrl(article.url),
          title: article.title,
          content: article.content ?? null,
          publishedAt,
          discoveredAt: scannedAt,
          tags: feed.tags ?? [],
          dedupHash: null,
        });
        if (result.inserted) {
          inserted += 1;
        }
      }

      db.markFeedScanSuccess(feed.name, scannedAt, latestArticleAt);
      results.push({
        feed: feed.name,
        url: feed.url,
        status: "ok",
        fetched: candidates.length,
        inserted,
      });
    } catch (error) {
      db.markFeedScanError(feed.name, scannedAt);
      results.push({
        feed: feed.name,
        url: feed.url,
        status: "error",
        fetched: 0,
        inserted: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    feeds: results,
    totals: {
      fetched: results.reduce((sum, result) => sum + result.fetched, 0),
      inserted: results.reduce((sum, result) => sum + result.inserted, 0),
      errors: results.filter((result) => result.status === "error").length,
    },
  };
}

export function normalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  return url.toString();
}

function normalizeTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function dedupeCandidates(candidates: FeedCandidateArticle[]): FeedCandidateArticle[] {
  const seen = new Set<string>();
  const unique: FeedCandidateArticle[] = [];

  for (const candidate of candidates) {
    const url = normalizeUrl(candidate.url);
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    unique.push(candidate);
  }

  return unique;
}
