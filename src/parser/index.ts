import { parseFeed, type Rss, type Atom, type Json } from "feedsmith";

import type { InsertArticleInput } from "../db";
import type { FeedDefinition } from "../types";

// ── Types ──

export interface ParsedArticle {
  url: string;
  title: string;
  content: string | null;
  publishedAt: string | null;
}

export interface ParseFeedResult {
  articles: ParsedArticle[];
  warnings: string[];
}

export interface FetchAndParseResult {
  articles: InsertArticleInput[];
  warnings: string[];
  error: string | null;
}

// ── Fetch ──

export async function fetchFeed(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "feeds-cli/0.1" },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.text();
}

// ── Normalize ──

function normalizeRssItems(items: Rss.Item<string>[]): ParseFeedResult {
  const articles: ParsedArticle[] = [];
  const warnings: string[] = [];

  for (const item of items) {
    const url =
      item.link ??
      (item.guid?.isPermaLink !== false ? item.guid?.value : undefined);
    if (!url) {
      warnings.push(`Skipped RSS item (no URL): ${item.title ?? "(untitled)"}`);
      continue;
    }
    articles.push({
      url,
      title: item.title ?? "(untitled)",
      content: item.content?.encoded ?? item.description ?? null,
      publishedAt: item.pubDate ?? null,
    });
  }

  return { articles, warnings };
}

function normalizeAtomEntries(
  entries: Atom.Entry<string>[],
): ParseFeedResult {
  const articles: ParsedArticle[] = [];
  const warnings: string[] = [];

  for (const entry of entries) {
    const url = extractAtomEntryUrl(entry);
    if (!url) {
      warnings.push(
        `Skipped Atom entry (no URL): ${entry.title?.value ?? "(untitled)"}`,
      );
      continue;
    }
    articles.push({
      url,
      title: entry.title?.value ?? "(untitled)",
      content: entry.content?.value ?? entry.summary?.value ?? null,
      publishedAt: entry.published ?? entry.updated ?? null,
    });
  }

  return { articles, warnings };
}

function extractAtomEntryUrl(
  entry: Atom.Entry<string>,
): string | undefined {
  if (!entry.links?.length) return entry.id;
  const alternate = entry.links.find((l) => l.rel === "alternate");
  if (alternate?.href) return alternate.href;
  return entry.links[0]?.href ?? entry.id;
}

function normalizeJsonItems(items: Json.Item<string>[]): ParseFeedResult {
  const articles: ParsedArticle[] = [];
  const warnings: string[] = [];

  for (const item of items) {
    const url = item.url ?? item.external_url;
    if (!url) {
      warnings.push(
        `Skipped JSON Feed item (no URL): ${item.title ?? "(untitled)"}`,
      );
      continue;
    }
    articles.push({
      url,
      title: item.title ?? "(untitled)",
      content: item.content_html ?? item.content_text ?? item.summary ?? null,
      publishedAt: item.date_published ?? null,
    });
  }

  return { articles, warnings };
}

// ── Parse ──

export function parseFeedContent(content: string): ParseFeedResult {
  const { format, feed } = parseFeed(content);

  switch (format) {
    case "rss":
      return normalizeRssItems(feed.items ?? []);
    case "atom":
      return normalizeAtomEntries(feed.entries ?? []);
    case "json":
      return normalizeJsonItems(feed.items ?? []);
    case "rdf":
      return normalizeRssItems(feed.items ?? []);
  }
}

// ── Orchestrator ──

export async function fetchAndParseFeed(
  feed: FeedDefinition,
): Promise<FetchAndParseResult> {
  if (feed.scrape) {
    return { articles: [], warnings: [], error: "scraping not yet implemented" };
  }

  let raw: string;
  try {
    raw = await fetchFeed(feed.url);
  } catch (e) {
    return {
      articles: [],
      warnings: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }

  let result: ParseFeedResult;
  try {
    result = parseFeedContent(raw);
  } catch (e) {
    return {
      articles: [],
      warnings: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const now = new Date().toISOString();
  const articles: InsertArticleInput[] = result.articles.map((a) => ({
    feedName: feed.name,
    url: a.url,
    title: a.title,
    content: a.content,
    publishedAt: a.publishedAt,
    discoveredAt: now,
    tags: feed.tags,
  }));

  return { articles, warnings: result.warnings, error: null };
}
