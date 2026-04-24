import { parseFeed, type Rss, type Atom, type Json, type Rdf } from "feedsmith";
import { XMLParser, XMLValidator } from "fast-xml-parser";

import type {
  ParsedArticle,
  ArticleAuthor,
  ArticleAttachment,
  FeedSourceDefinition,
  SitemapConfig,
} from "../types";

// ── Helpers ──

function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function detectSitemapRoot(content: string): "urlset" | "sitemapindex" | null {
  const withoutPreamble = content
    .replace(/^\uFEFF/, "")
    .trimStart()
    .replace(/^<\?xml[^>]*>\s*/i, "")
    .replace(/^(?:<!--[\s\S]*?-->\s*)*/, "");
  const match = withoutPreamble.match(
    /^<(?:(?:[A-Za-z_][\w.-]*):)?(urlset|sitemapindex)(?=[\s>])/,
  );
  return match?.[1] === "urlset" || match?.[1] === "sitemapindex"
    ? match[1]
    : null;
}

type XmlNode = Record<string, unknown>;

const sitemapXmlParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (tagName) => tagName === "url" || tagName === "sitemap",
});

function parseSitemapDocument(content: string): {
  rootName: "urlset" | "sitemapindex";
  root: XmlNode;
} {
  const validation = XMLValidator.validate(content);
  if (validation !== true) {
    throw new Error(`Invalid XML: ${validation.err.msg}`);
  }

  const parsed = sitemapXmlParser.parse(content) as XmlNode;
  const rootName = ["urlset", "sitemapindex"].find((name) =>
    isXmlNode(parsed[name]),
  );
  if (rootName !== "urlset" && rootName !== "sitemapindex") {
    const actual = Object.keys(parsed)[0] ?? "(empty)";
    throw new Error(`Unsupported sitemap root: ${actual}`);
  }

  return { rootName, root: parsed[rootName] as XmlNode };
}

function isXmlNode(value: unknown): value is XmlNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asXmlNodeArray(value: unknown): XmlNode[] {
  if (Array.isArray(value)) return value.filter(isXmlNode);
  return isXmlNode(value) ? [value] : [];
}

function xmlText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function humanizeUrlTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split("/").filter(Boolean).at(-1);
    if (!segment) return url;
    const decoded = decodeURIComponent(segment).replace(/\.[A-Za-z0-9]+$/, "");
    const words = decoded.replace(/[-_]+/g, " ").trim();
    if (!words) return url;
    return words.replace(/\b\p{L}/gu, (char) => char.toLocaleUpperCase());
  } catch {
    return url;
  }
}

function compileSitemapFilters(config?: SitemapConfig): {
  include: RegExp[];
  exclude: RegExp[];
} {
  return {
    include: config?.include?.map((pattern) => new RegExp(pattern)) ?? [],
    exclude: config?.exclude?.map((pattern) => new RegExp(pattern)) ?? [],
  };
}

function matchesSitemapFilters(
  url: string,
  filters: ReturnType<typeof compileSitemapFilters>,
): boolean {
  if (filters.include.length > 0 && !filters.include.some((re) => re.test(url))) {
    return false;
  }
  return !filters.exclude.some((re) => re.test(url));
}

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

interface ParseSitemapOptions {
  filters?: ReturnType<typeof compileSitemapFilters>;
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
      publishedAt: normalizeDate(item.pubDate),
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
      publishedAt: normalizeDate(entry.published),
      updatedAt: normalizeDate(entry.updated),
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
      publishedAt: normalizeDate(item.date_published),
      updatedAt: normalizeDate(item.date_modified),
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
      publishedAt: normalizeDate(item.dc?.dates?.[0]),
      updatedAt: null,
      language: item.dc?.languages?.[0] ?? null,
      sourceFormat: "rdf",
    });
  }

  return { articles, warnings };
}

// ── Normalize: Sitemap ──

export function parseSitemapContent(
  content: string,
  config?: SitemapConfig,
): ParseFeedResult {
  return parseSitemapXml(content, {
    filters: compileSitemapFilters(config),
  });
}

function parseSitemapXml(
  content: string,
  options: ParseSitemapOptions = {},
): ParseFeedResult {
  const { rootName, root } = parseSitemapDocument(content);

  if (rootName === "urlset") {
    return normalizeSitemapUrls(root, options);
  }

  if (rootName === "sitemapindex") {
    return {
      articles: [],
      warnings: [
        "Skipped sitemapindex children during synchronous parsing; use fetchAndParseFeedSource for recursive sitemap parsing",
      ],
    };
  }

  throw new Error(`Unsupported sitemap root: ${rootName}`);
}

function normalizeSitemapUrls(
  urlset: XmlNode,
  options: ParseSitemapOptions,
): ParseFeedResult {
  const articles: ParsedArticle[] = [];
  const warnings: string[] = [];
  const filters = options.filters ?? compileSitemapFilters();

  for (const entry of asXmlNodeArray(urlset.url)) {
    const loc = xmlText(entry.loc);
    if (!loc) {
      warnings.push("Skipped sitemap url entry (no loc)");
      continue;
    }

    if (!matchesSitemapFilters(loc, filters)) {
      continue;
    }

    articles.push({
      url: loc,
      externalId: loc,
      title: humanizeUrlTitle(loc),
      summary: null,
      content: null,
      authors: [],
      categories: [],
      attachments: [],
      publishedAt: null,
      updatedAt: normalizeDate(xmlText(entry.lastmod)),
      language: null,
      sourceFormat: "sitemap",
    });
  }

  return { articles, warnings };
}

// ── Detect ──

export function detectFeedFormat(
  content: string,
): "rss" | "atom" | "json" | "rdf" | "sitemap" {
  if (detectSitemapRoot(content)) return "sitemap";
  const { format } = parseFeed(content);
  return format;
}

// ── Parse ──

export function parseFeedContent(content: string): ParseFeedResult {
  if (detectSitemapRoot(content)) {
    return parseSitemapContent(content);
  }

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

const MAX_SITEMAP_DEPTH = 5;

async function fetchAndParseSitemapSource(
  source: FeedSourceDefinition,
): Promise<FetchAndParseResult> {
  const filters = compileSitemapFilters(source.sitemap);
  const visited = new Set<string>();

  try {
    const result = await fetchAndParseSitemapUrl(
      source.url,
      filters,
      visited,
      0,
    );
    return { ...result, error: null };
  } catch (e) {
    return {
      articles: [],
      warnings: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function fetchAndParseSitemapUrl(
  url: string,
  filters: ReturnType<typeof compileSitemapFilters>,
  visited: Set<string>,
  depth: number,
): Promise<ParseFeedResult> {
  if (depth > MAX_SITEMAP_DEPTH) {
    return {
      articles: [],
      warnings: [`Skipped sitemap ${url} (max depth ${MAX_SITEMAP_DEPTH} exceeded)`],
    };
  }

  if (visited.has(url)) {
    return {
      articles: [],
      warnings: [`Skipped already visited sitemap: ${url}`],
    };
  }
  visited.add(url);

  const raw = await fetchFeed(url);
  const { rootName, root } = parseSitemapDocument(raw);

  if (rootName === "urlset") {
    return normalizeSitemapUrls(root, { filters });
  }

  const articles: ParsedArticle[] = [];
  const warnings: string[] = [];

  for (const sitemap of asXmlNodeArray(root.sitemap)) {
    const loc = xmlText(sitemap.loc);
    if (!loc) {
      warnings.push("Skipped sitemapindex entry (no loc)");
      continue;
    }

    const child = await fetchAndParseSitemapUrl(
      loc,
      filters,
      visited,
      depth + 1,
    );
    articles.push(...child.articles);
    warnings.push(...child.warnings);
  }

  return { articles, warnings };
}

// ── Orchestrator ──

export async function fetchAndParseFeedSource(
  source: FeedSourceDefinition,
): Promise<FetchAndParseResult> {
  if (source.kind === "sitemap" || source.sitemap) {
    return fetchAndParseSitemapSource(source);
  }

  if (source.kind === "activitypub") {
    return {
      articles: [],
      warnings: [],
      error: "activitypub not yet implemented",
    };
  }

  if (source.scrape) {
    return { articles: [], warnings: [], error: "scraping not yet implemented" };
  }

  let raw: string;
  try {
    raw = await fetchFeed(source.url);
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
