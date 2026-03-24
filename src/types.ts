export type OutputFormat = "human" | "json";

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

export interface FeedStateRecord {
  name: string;
  url: string;
  lastScannedAt: string | null;
  lastArticleAt: string | null;
  errorCount: number;
  status: "active" | "dead" | "error";
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

export interface FeedCandidateArticle {
  url: string;
  title: string;
  publishedAt?: string | null;
  content?: string | null;
}

export interface ScanFeedResult {
  feed: string;
  url: string;
  status: "ok" | "error";
  fetched: number;
  inserted: number;
  error?: string;
}

export interface ScanSummary {
  feeds: ScanFeedResult[];
  totals: {
    fetched: number;
    inserted: number;
    errors: number;
  };
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CliStreams {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface CliDeps extends CliStreams {
  fetchImpl: FetchLike;
  now: () => Date;
}
