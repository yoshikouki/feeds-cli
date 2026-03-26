import { parseFeed, type Rss, type Atom, type Json, type Rdf } from "feedsmith";

import type {
  ParsedArticle,
  ArticleAuthor,
  ArticleAttachment,
  FeedDefinition,
} from "../types";

// ── Types ──

export type { ParsedArticle };

export interface ParseFeedResult {
  articles: ParsedArticle[];
  warnings: string[];
}

export interface FetchAndParseResult {
  articles: ParsedArticle[];
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

// ── Normalize: RSS ──

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
      externalId: item.guid?.value ?? null,
      title: item.title ?? "(untitled)",
      summary: item.description ?? null,
      content: item.content?.encoded ?? null,
      authors: item.authors?.map((a) => ({ name: a })) ?? [],
      categories: item.categories?.map((c) => c.name ?? "") .filter(Boolean) ?? [],
      attachments:
        item.enclosures?.map((e) => ({
          url: e.url ?? "",
          mimeType: e.type,
          sizeInBytes: e.length,
        })).filter((a) => a.url) ?? [],
      publishedAt: item.pubDate ?? null,
      updatedAt: null,
      language: null,
      sourceFormat: "rss",
    });
  }

  return { articles, warnings };
}

// ── Normalize: Atom ──

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

    const enclosures: ArticleAttachment[] =
      entry.links
        ?.filter((l) => l.rel === "enclosure" && l.href)
        .map((l) => ({
          url: l.href!,
          mimeType: l.type,
          sizeInBytes: l.length,
        })) ?? [];

    articles.push({
      url,
      externalId: entry.id ?? null,
      title: entry.title?.value ?? "(untitled)",
      summary: entry.summary?.value ?? null,
      content: entry.content?.value ?? null,
      authors:
        entry.authors?.map((a) => ({
          name: a.name ?? "",
          url: a.uri,
          email: a.email,
        })).filter((a) => a.name) ?? [],
      categories: entry.categories?.map((c) => c.term ?? "").filter(Boolean) ?? [],
      attachments: enclosures,
      publishedAt: entry.published ?? null,
      updatedAt: entry.updated ?? null,
      language: null,
      sourceFormat: "atom",
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

// ── Normalize: JSON Feed ──

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
      externalId: item.id ?? null,
      title: item.title ?? "(untitled)",
      summary: item.summary ?? null,
      content: item.content_html ?? item.content_text ?? null,
      authors:
        item.authors?.map((a) => ({
          name: a.name ?? "",
          url: a.url,
        })).filter((a) => a.name) ?? [],
      categories: item.tags ?? [],
      attachments:
        item.attachments?.map((a) => ({
          url: a.url ?? "",
          mimeType: a.mime_type,
          title: a.title,
          sizeInBytes: a.size_in_bytes,
          durationInSeconds: a.duration_in_seconds,
        })).filter((a) => a.url) ?? [],
      publishedAt: item.date_published ?? null,
      updatedAt: item.date_modified ?? null,
      language: item.language ?? null,
      sourceFormat: "json",
    });
  }

  return { articles, warnings };
}

// ── Normalize: RDF ──

function normalizeRdfItems(items: Rdf.Item<string>[]): ParseFeedResult {
  const articles: ParsedArticle[] = [];
  const warnings: string[] = [];

  for (const item of items) {
    const url = item.link;
    if (!url) {
      warnings.push(`Skipped RDF item (no URL): ${item.title ?? "(untitled)"}`);
      continue;
    }
    articles.push({
      url,
      externalId: item.rdf?.about ?? null,
      title: item.title ?? "(untitled)",
      summary: item.description ?? null,
      content: item.content?.encoded ?? null,
      authors: item.dc?.creators?.map((c) => ({ name: c })) ?? [],
      categories: item.dc?.subjects ?? [],
      attachments: [],
      publishedAt: item.dc?.dates?.[0] ?? null,
      updatedAt: null,
      language: item.dc?.languages?.[0] ?? null,
      sourceFormat: "rdf",
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
      return normalizeRdfItems(feed.items ?? []);
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

  try {
    const result = parseFeedContent(raw);
    return { articles: result.articles, warnings: result.warnings, error: null };
  } catch (e) {
    return {
      articles: [],
      warnings: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
