export type FeedStatus = "active" | "dead" | "error";

// ─── Config (JSON5 file shape) ───

export interface ScrapeConfig {
  selector: string;
  titleSelector?: string;
  dateSelector?: string;
}

export interface FeedDefinition {
  name: string;
  url: string;
  tags?: string[];
  scrape?: ScrapeConfig;
}

export interface ConfigFile {
  feeds: FeedDefinition[];
}

// ─── DB Records ───

export interface FeedStateRecord {
  name: string;
  url: string;
  lastScannedAt: string | null;
  lastArticleAt: string | null;
  errorCount: number;
  status: FeedStatus;
}

export interface ArticleRecord {
  id: string;
  feedName: string;
  url: string;
  title: string;
  content: string | null;
  publishedAt: string | null;
  discoveredAt: string;
  read: boolean;
  tags: string[];
  dedupHash: string | null;
}
