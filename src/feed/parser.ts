import { XMLParser } from "fast-xml-parser";

import type { FeedCandidateArticle } from "../types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: true,
});

export function parseFeedXml(xml: string): FeedCandidateArticle[] {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  if ("rss" in parsed) {
    return parseRss(parsed.rss as Record<string, unknown>);
  }
  if ("feed" in parsed) {
    return parseAtom(parsed.feed as Record<string, unknown>);
  }
  throw new Error("unsupported feed format");
}

function parseRss(rss: Record<string, unknown>): FeedCandidateArticle[] {
  const channel = rss.channel as Record<string, unknown> | undefined;
  const items = toArray(channel?.item);
  const results: FeedCandidateArticle[] = [];
  for (const item of items) {
    const entry = item as Record<string, unknown>;
    const url = asString(entry.link);
    const title = asString(entry.title);
    if (!url || !title) {
      continue;
    }
    results.push({
      url,
      title,
      content: asString(entry["content:encoded"]) ?? asString(entry.description) ?? null,
      publishedAt: asString(entry.pubDate) ?? null,
    });
  }
  return results;
}

function parseAtom(feed: Record<string, unknown>): FeedCandidateArticle[] {
  const entries = toArray(feed.entry);
  const results: FeedCandidateArticle[] = [];
  for (const item of entries) {
    const entry = item as Record<string, unknown>;
    const title = asString(entry.title);
    const url = getAtomLink(entry.link);
    if (!url || !title) {
      continue;
    }
    results.push({
      url,
      title,
      content: asString(entry.content) ?? asString(entry.summary) ?? null,
      publishedAt: asString(entry.updated) ?? asString(entry.published) ?? null,
    });
  }
  return results;
}

function getAtomLink(value: unknown): string | null {
  const links = toArray(value).map((link) => link as Record<string, unknown>);
  const preferred =
    links.find((link) => asString(link["@_rel"]) === "alternate" && asString(link["@_href"])) ??
    links.find((link) => asString(link["@_href"]));
  return preferred ? asString(preferred["@_href"]) : null;
}

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}
