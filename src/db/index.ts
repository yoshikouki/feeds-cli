import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";

import type { ArticleRecord, FeedDefinition, FeedStateRecord } from "../types";

interface ArticleRow {
  id: string;
  feed_name: string;
  url: string;
  title: string;
  content: string | null;
  published_at: string | null;
  discovered_at: string;
  read: number;
  tags: string | null;
  dedup_hash: string | null;
}

interface FeedRow {
  name: string;
  url: string;
  last_scanned_at: string | null;
  last_article_at: string | null;
  error_count: number;
  status: "active" | "dead" | "error";
}

export interface ListArticleFilters {
  unread?: boolean;
  feed?: string;
  since?: string;
  limit?: number;
}

export interface InsertArticleInput {
  feedName: string;
  url: string;
  title: string;
  content?: string | null;
  publishedAt?: string | null;
  discoveredAt: string;
  tags?: string[];
  dedupHash?: string | null;
}

export class FeedDatabase implements Disposable {
  readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS articles (
        id TEXT PRIMARY KEY,
        feed_name TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        content TEXT,
        published_at TEXT,
        discovered_at TEXT NOT NULL,
        read INTEGER NOT NULL DEFAULT 0,
        tags TEXT,
        dedup_hash TEXT
      );

      CREATE TABLE IF NOT EXISTS feeds (
        name TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        last_scanned_at TEXT,
        last_article_at TEXT,
        error_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active'
      );

      CREATE INDEX IF NOT EXISTS idx_articles_feed_name ON articles(feed_name);
      CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);
      CREATE INDEX IF NOT EXISTS idx_articles_discovered_at ON articles(discovered_at);
    `);
  }

  close(): void {
    this.db.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }

  // ── Feed operations ──

  upsertFeedDefinition(feed: FeedDefinition): void {
    this.db
      .query(
        `INSERT INTO feeds (name, url, status)
         VALUES (?, ?, 'active')
         ON CONFLICT(name) DO UPDATE SET url = excluded.url`,
      )
      .run(feed.name, feed.url);
  }

  removeFeed(name: string): void {
    this.db.query("DELETE FROM feeds WHERE name = ?").run(name);
    this.db.query("DELETE FROM articles WHERE feed_name = ?").run(name);
  }

  listFeedStates(): FeedStateRecord[] {
    const rows = this.db
      .query<FeedRow, []>(
        "SELECT name, url, last_scanned_at, last_article_at, error_count, status FROM feeds ORDER BY name ASC",
      )
      .all();
    return rows.map((row) => ({
      name: row.name,
      url: row.url,
      lastScannedAt: row.last_scanned_at,
      lastArticleAt: row.last_article_at,
      errorCount: row.error_count,
      status: row.status,
    }));
  }

  markFeedScanSuccess(
    name: string,
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
         WHERE name = ?`,
      )
      .run(scannedAt, lastArticleAt, name);
  }

  markFeedScanError(name: string, scannedAt: string): void {
    this.db
      .query(
        `UPDATE feeds
         SET last_scanned_at = ?,
             error_count = error_count + 1,
             status = 'error'
         WHERE name = ?`,
      )
      .run(scannedAt, name);
  }

  // ── Article operations ──

  insertArticle(
    input: InsertArticleInput,
  ): { inserted: boolean; id: string | null } {
    const id = randomUUID();
    const result = this.db
      .query(
        `INSERT OR IGNORE INTO articles
         (id, feed_name, url, title, content, published_at, discovered_at, read, tags, dedup_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        id,
        input.feedName,
        input.url,
        input.title,
        input.content ?? null,
        input.publishedAt ?? null,
        input.discoveredAt,
        JSON.stringify(input.tags ?? []),
        input.dedupHash ?? null,
      );

    return {
      inserted: result.changes > 0,
      id: result.changes > 0 ? id : null,
    };
  }

  listArticles(filters: ListArticleFilters): ArticleRecord[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (filters.unread) {
      clauses.push("read = 0");
    }
    if (filters.feed) {
      clauses.push("feed_name = ?");
      params.push(filters.feed);
    }
    if (filters.since) {
      clauses.push("COALESCE(published_at, discovered_at) >= ?");
      params.push(filters.since);
    }

    const whereClause =
      clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limitClause = filters.limit ? `LIMIT ${filters.limit}` : "";
    const rows = this.db
      .query<ArticleRow, Array<string | number>>(
        `SELECT id, feed_name, url, title, content, published_at, discovered_at, read, tags, dedup_hash
         FROM articles
         ${whereClause}
         ORDER BY COALESCE(published_at, discovered_at) DESC, discovered_at DESC
         ${limitClause}`,
      )
      .all(...params);

    return rows.map((row) => ({
      id: row.id,
      feedName: row.feed_name,
      url: row.url,
      title: row.title,
      content: row.content,
      publishedAt: row.published_at,
      discoveredAt: row.discovered_at,
      read: row.read === 1,
      tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
      dedupHash: row.dedup_hash,
    }));
  }

  markArticleRead(id: string): boolean {
    return (
      this.db.query("UPDATE articles SET read = 1 WHERE id = ?").run(id)
        .changes > 0
    );
  }

  markAllRead(feedName?: string): number {
    if (feedName) {
      return this.db
        .query("UPDATE articles SET read = 1 WHERE feed_name = ?")
        .run(feedName).changes;
    }
    return this.db.query("UPDATE articles SET read = 1").run().changes;
  }
}
