import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";

import type {
  Article,
  ArticleAttachment,
  ArticleAuthor,
  FeedDefinition,
  FeedState,
  FeedStatus,
  InsertArticleInput,
  SourceFormat,
} from "../types";

// ── Internal row types ──

interface ArticleRow {
  id: string;
  feed_id: string;
  url: string;
  external_id: string | null;
  title: string;
  summary: string | null;
  content: string | null;
  authors: string | null;
  categories: string | null;
  attachments: string | null;
  published_at: string | null;
  updated_at: string | null;
  discovered_at: string;
  language: string | null;
  source_format: string;
  read: number;
  dedup_hash: string | null;
}

interface FeedRow {
  id: string;
  name: string;
  url: string;
  last_scanned_at: string | null;
  last_article_at: string | null;
  error_count: number;
  status: string;
}

// ── Public types ──

export interface ListArticleFilters {
  unread?: boolean;
  feedId?: string;
  feedName?: string;
  tag?: string;
  search?: string;
  since?: string;
  limit?: number;
}

// ── Database ──

export class FeedDatabase implements Disposable {
  readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA foreign_keys = ON");
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feeds (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        last_scanned_at TEXT,
        last_article_at TEXT,
        error_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_feeds_name ON feeds(name);

      CREATE TABLE IF NOT EXISTS articles (
        id TEXT PRIMARY KEY,
        feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        external_id TEXT,
        title TEXT NOT NULL,
        summary TEXT,
        content TEXT,
        authors TEXT,
        categories TEXT,
        attachments TEXT,
        published_at TEXT,
        updated_at TEXT,
        discovered_at TEXT NOT NULL,
        language TEXT,
        source_format TEXT NOT NULL,
        read INTEGER NOT NULL DEFAULT 0,
        dedup_hash TEXT,
        UNIQUE(feed_id, url)
      );
      CREATE INDEX IF NOT EXISTS idx_articles_feed_id ON articles(feed_id);
      CREATE INDEX IF NOT EXISTS idx_articles_discovered_at ON articles(discovered_at);

      CREATE TABLE IF NOT EXISTS article_tags (
        article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (article_id, tag)
      );
      CREATE INDEX IF NOT EXISTS idx_article_tags_tag ON article_tags(tag);

      CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
        title, summary, content,
        content=articles, content_rowid=rowid
      );

      CREATE TRIGGER IF NOT EXISTS articles_fts_insert AFTER INSERT ON articles BEGIN
        INSERT INTO articles_fts(rowid, title, summary, content)
        VALUES (new.rowid, new.title, new.summary, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS articles_fts_delete AFTER DELETE ON articles BEGIN
        INSERT INTO articles_fts(articles_fts, rowid, title, summary, content)
        VALUES ('delete', old.rowid, old.title, old.summary, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS articles_fts_update AFTER UPDATE ON articles BEGIN
        INSERT INTO articles_fts(articles_fts, rowid, title, summary, content)
        VALUES ('delete', old.rowid, old.title, old.summary, old.content);
        INSERT INTO articles_fts(rowid, title, summary, content)
        VALUES (new.rowid, new.title, new.summary, new.content);
      END;
    `);
  }

  close(): void {
    this.db.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }

  // ── Feed operations ──

  upsertFeedFromConfig(feed: FeedDefinition): FeedState {
    const existing = this.db
      .query<FeedRow, [string]>("SELECT * FROM feeds WHERE name = ?")
      .get(feed.name);

    if (existing) {
      this.db
        .query("UPDATE feeds SET url = ? WHERE id = ?")
        .run(feed.url, existing.id);
      return this.toFeedState({ ...existing, url: feed.url });
    }

    const id = randomUUID();
    this.db
      .query(
        "INSERT INTO feeds (id, name, url, status) VALUES (?, ?, ?, 'active')",
      )
      .run(id, feed.name, feed.url);

    return {
      id,
      name: feed.name,
      url: feed.url,
      lastScannedAt: null,
      lastArticleAt: null,
      errorCount: 0,
      status: "active",
    };
  }

  removeFeed(name: string): void {
    // CASCADE handles articles and article_tags
    this.db.query("DELETE FROM feeds WHERE name = ?").run(name);
  }

  listFeedStates(): FeedState[] {
    const rows = this.db
      .query<FeedRow, []>("SELECT * FROM feeds ORDER BY name ASC")
      .all();
    return rows.map((row) => this.toFeedState(row));
  }

  getFeedByName(name: string): FeedState | null {
    const row = this.db
      .query<FeedRow, [string]>("SELECT * FROM feeds WHERE name = ?")
      .get(name);
    return row ? this.toFeedState(row) : null;
  }

  markFeedScanSuccess(
    feedId: string,
    scannedAt: string,
    lastArticleAt: string | null,
  ): void {
    this.db
      .query(
        `UPDATE feeds
         SET last_scanned_at = ?,
             last_article_at = COALESCE(?, last_article_at),
             error_count = 0,
             status = 'active'
         WHERE id = ?`,
      )
      .run(scannedAt, lastArticleAt, feedId);
  }

  markFeedScanError(feedId: string, scannedAt: string): void {
    this.db
      .query(
        `UPDATE feeds
         SET last_scanned_at = ?,
             error_count = error_count + 1,
             status = 'error'
         WHERE id = ?`,
      )
      .run(scannedAt, feedId);
  }

  // ── Article operations ──

  insertArticle(
    input: InsertArticleInput,
  ): { inserted: boolean; id: string | null } {
    const id = randomUUID();

    const result = this.db
      .query(
        `INSERT OR IGNORE INTO articles
         (id, feed_id, url, external_id, title, summary, content,
          authors, categories, attachments,
          published_at, updated_at, discovered_at,
          language, source_format, read, dedup_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        id,
        input.feedId,
        input.url,
        input.externalId ?? null,
        input.title,
        input.summary ?? null,
        input.content ?? null,
        JSON.stringify(input.authors ?? []),
        JSON.stringify(input.categories ?? []),
        JSON.stringify(input.attachments ?? []),
        input.publishedAt ?? null,
        input.updatedAt ?? null,
        input.discoveredAt,
        input.language ?? null,
        input.sourceFormat,
        input.dedupHash ?? null,
      );

    if (result.changes > 0 && input.tags?.length) {
      const insertTag = this.db.query(
        "INSERT OR IGNORE INTO article_tags (article_id, tag) VALUES (?, ?)",
      );
      for (const tag of input.tags) {
        insertTag.run(id, tag);
      }
    }

    return {
      inserted: result.changes > 0,
      id: result.changes > 0 ? id : null,
    };
  }

  listArticles(filters: ListArticleFilters): Article[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    let needTagJoin = false;
    let needFtsJoin = false;

    if (filters.unread) {
      clauses.push("a.read = 0");
    }
    if (filters.feedId) {
      clauses.push("a.feed_id = ?");
      params.push(filters.feedId);
    }
    if (filters.feedName) {
      clauses.push("a.feed_id = (SELECT id FROM feeds WHERE name = ?)");
      params.push(filters.feedName);
    }
    if (filters.tag) {
      needTagJoin = true;
      clauses.push("t.tag = ?");
      params.push(filters.tag);
    }
    if (filters.search) {
      needFtsJoin = true;
      clauses.push("articles_fts MATCH ?");
      params.push(filters.search);
    }
    if (filters.since) {
      clauses.push("COALESCE(a.published_at, a.discovered_at) >= ?");
      params.push(filters.since);
    }

    const joins: string[] = [];
    if (needTagJoin) {
      joins.push("JOIN article_tags t ON t.article_id = a.id");
    }
    if (needFtsJoin) {
      joins.push("JOIN articles_fts ON articles_fts.rowid = a.rowid");
    }

    const whereClause =
      clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limitClause = filters.limit ? `LIMIT ${filters.limit}` : "";

    const rows = this.db
      .query<ArticleRow, Array<string | number>>(
        `SELECT DISTINCT a.*
         FROM articles a
         ${joins.join(" ")}
         ${whereClause}
         ORDER BY COALESCE(a.published_at, a.discovered_at) DESC, a.discovered_at DESC
         ${limitClause}`,
      )
      .all(...params);

    return rows.map((row) => this.toArticle(row));
  }

  markArticleRead(id: string): boolean {
    const count = this.db
      .query<{ c: number }, [string]>(
        "SELECT COUNT(*) as c FROM articles WHERE id = ? AND read = 0",
      )
      .get(id);
    if (!count || count.c === 0) return false;
    this.db.query("UPDATE articles SET read = 1 WHERE id = ?").run(id);
    return true;
  }

  markAllRead(feedName?: string): number {
    const countQuery = feedName
      ? this.db
          .query<{ c: number }, [string]>(
            "SELECT COUNT(*) as c FROM articles WHERE read = 0 AND feed_id = (SELECT id FROM feeds WHERE name = ?)",
          )
          .get(feedName)
      : this.db
          .query<{ c: number }, []>(
            "SELECT COUNT(*) as c FROM articles WHERE read = 0",
          )
          .get();

    const n = countQuery?.c ?? 0;
    if (n === 0) return 0;

    if (feedName) {
      this.db
        .query(
          "UPDATE articles SET read = 1 WHERE read = 0 AND feed_id = (SELECT id FROM feeds WHERE name = ?)",
        )
        .run(feedName);
    } else {
      this.db.query("UPDATE articles SET read = 1 WHERE read = 0").run();
    }
    return n;
  }

  // ── Private helpers ──

  private toFeedState(row: FeedRow): FeedState {
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      lastScannedAt: row.last_scanned_at,
      lastArticleAt: row.last_article_at,
      errorCount: row.error_count,
      status: row.status as FeedStatus,
    };
  }

  private toArticle(row: ArticleRow): Article {
    // Load tags from junction table
    const tags = this.db
      .query<{ tag: string }, [string]>(
        "SELECT tag FROM article_tags WHERE article_id = ? ORDER BY tag",
      )
      .all(row.id)
      .map((r) => r.tag);

    return {
      id: row.id,
      feedId: row.feed_id,
      url: row.url,
      externalId: row.external_id,
      title: row.title,
      summary: row.summary,
      content: row.content,
      authors: row.authors ? (JSON.parse(row.authors) as ArticleAuthor[]) : [],
      categories: row.categories
        ? (JSON.parse(row.categories) as string[])
        : [],
      attachments: row.attachments
        ? (JSON.parse(row.attachments) as ArticleAttachment[])
        : [],
      publishedAt: row.published_at,
      updatedAt: row.updated_at,
      discoveredAt: row.discovered_at,
      language: row.language,
      sourceFormat: row.source_format as SourceFormat,
      read: row.read === 1,
      tags,
      dedupHash: row.dedup_hash,
    };
  }
}
