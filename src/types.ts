import { randomUUID } from "node:crypto";

// ─── Config (JSON5 file shape) ───

export interface ScrapeConfig {
  selector: string;
  titleSelector?: string;
  dateSelector?: string;
}

export type FeedSourceKind =
  | "rss"
  | "atom"
  | "json"
  | "rdf"
  | "scrape"
  | "activitypub";

export interface FeedSourceDefinition {
  id?: string;
  kind?: FeedSourceKind;
  url: string;
  tags?: string[];
  scrape?: ScrapeConfig;
}

export interface FeedDefinition {
  id?: string;
  name: string;
  url: string;
  tags?: string[];
  scrape?: ScrapeConfig;
  sources?: FeedSourceDefinition[];
}

export interface ConfigFile {
  feeds: FeedDefinition[];
}

// ─── Domain ───

export type FeedStatus = "active" | "dead" | "error";
export type SourceFormat = "rss" | "atom" | "json" | "rdf" | "scrape";

export interface ArticleAuthor {
  name: string;
  url?: string;
  email?: string;
}

export interface ArticleAttachment {
  url: string;
  mimeType?: string;
  title?: string;
  sizeInBytes?: number;
  durationInSeconds?: number;
}

export interface FeedState {
  id: string;
  name: string;
  url: string;
  aliases?: string[];
  sourceCount?: number;
  lastScannedAt: string | null;
  lastArticleAt: string | null;
  errorCount: number;
  status: FeedStatus;
}

/** Parser output — format-agnostic, DB-independent */
export interface ParsedArticle {
  url: string;
  externalId: string | null;
  title: string;
  summary: string | null;
  content: string | null;
  authors: ArticleAuthor[];
  categories: string[];
  attachments: ArticleAttachment[];
  publishedAt: string | null;
  updatedAt: string | null;
  language: string | null;
  sourceFormat: SourceFormat;
}

/** DB insertion input */
export interface InsertArticleInput {
  feedId: string;
  feedSourceId?: string;
  url: string;
  externalId?: string | null;
  title: string;
  summary?: string | null;
  content?: string | null;
  authors?: ArticleAuthor[];
  categories?: string[];
  attachments?: ArticleAttachment[];
  publishedAt?: string | null;
  updatedAt?: string | null;
  discoveredAt: string;
  language?: string | null;
  sourceFormat: SourceFormat;
  tags?: string[];
  dedupHash?: string | null;
}

/** Full article record from DB */
export interface Article {
  id: string;
  canonicalId?: string;
  feedId: string;
  feedSourceId?: string;
  url: string;
  externalId: string | null;
  title: string;
  summary: string | null;
  content: string | null;
  authors: ArticleAuthor[];
  categories: string[];
  attachments: ArticleAttachment[];
  publishedAt: string | null;
  updatedAt: string | null;
  discoveredAt: string;
  language: string | null;
  sourceFormat: SourceFormat;
  read: boolean;
  tags: string[];
  dedupHash: string | null;
}

export function createId(): string {
  return randomUUID();
}
