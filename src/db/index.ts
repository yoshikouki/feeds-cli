import { join } from "node:path";
import { Database } from "bun:sqlite";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import type {
  Article,
  ArticleAttachment,
  ArticleAuthor,
  FeedDefinition,
  FeedSourceKind,
  FeedSourceState,
  FeedState,
  FeedStatus,
  InsertArticleInput,
  SourceFormat,
} from "../types";
import { createId } from "../types";
import { normalizeFeedDefinition } from "../config";
import {
  articleOccurrences,
  articleStates,
  articleTags,
  canonicalArticles,
  feedAliases,
  feeds,
  feedSourceStates,
  feedSources,
  feedSourceTags,
} from "./schema";

export interface ListArticleFilters {
  unread?: boolean;
  feedId?: string;
  feedName?: string;
  tag?: string;
  search?: string;
  since?: string;
  limit?: number;
}

type DrizzleDb = BunSQLiteDatabase<typeof import("./schema")>;

interface ArticleListRow {
  id: string;
  canonicalId: string;
  feedId: string;
  feedSourceId: string;
  url: string;
  externalId: string | null;
  title: string;
  summary: string | null;
  content: string | null;
  authors: string | null;
  categories: string | null;
  attachments: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  discoveredAt: string;
  language: string | null;
  sourceFormat: string;
  readAt: string | null;
}

interface FeedStateRow {
  id: string;
  name: string;
  aliases: string | null;
  sourceCount: number;
  primarySourceId: string | null;
  primarySourceName: string | null;
  lastScannedAt: string | null;
  lastArticleAt: string | null;
  errorCount: number;
  status: string;
}

interface FeedSourceStateRow {
  id: string;
  feedId: string;
  name: string;
  kind: string;
  url: string;
  position: number;
  tags: string | null;
  lastScannedAt: string | null;
  lastArticleAt: string | null;
  errorCount: number;
  status: string;
  lastError: string | null;
}

const MIGRATIONS_FOLDER = join(import.meta.dir, "migrations");

export class FeedDatabase implements Disposable {
  readonly sqlite: Database;
  readonly db: DrizzleDb;

  constructor(path: string) {
    this.sqlite = new Database(path, { create: true });
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    this.db = drizzle(this.sqlite, {
      schema: {
        articleOccurrences,
        articleStates,
        articleTags,
        canonicalArticles,
        feedAliases,
        feeds,
        feedSourceStates,
        feedSources,
        feedSourceTags,
      },
    });
    migrate(this.db, { migrationsFolder: MIGRATIONS_FOLDER });
  }

  close(): void {
    this.sqlite.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }

  upsertFeedFromConfig(feedInput: FeedDefinition): FeedState {
    const feed = normalizeFeedDefinition(feedInput);
    const now = new Date().toISOString();

    this.db.transaction((tx) => {
      const existing =
        tx.select().from(feeds).where(eq(feeds.id, feed.id!)).get() ??
        tx.select().from(feeds).where(eq(feeds.name, feed.name)).get();

      if (!existing) {
        tx.insert(feeds).values({
          id: feed.id!,
          name: feed.name,
          createdAt: now,
          updatedAt: now,
        }).run();
      } else {
        tx.update(feeds)
          .set({ name: feed.name, updatedAt: now })
          .where(eq(feeds.id, existing.id))
          .run();

        if (existing.name !== feed.name) {
          tx.insert(feedAliases)
            .values({ feedId: existing.id, alias: existing.name })
            .onConflictDoNothing()
            .run();
        }
      }

      const feedId = existing?.id ?? feed.id!;

      const persistedSources = tx
        .select()
        .from(feedSources)
        .where(eq(feedSources.feedId, feedId))
        .all();
      const sourceIds = new Set(feed.sources.map((source) => source.id!));

      for (const [position, source] of feed.sources.entries()) {
        tx.insert(feedSources)
          .values({
            id: source.id!,
            feedId,
            position,
            name: source.name,
            kind: source.kind ?? inferSourceKind(source.url),
            url: source.url,
            scrapeConfig: source.scrape ? JSON.stringify(source.scrape) : null,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: feedSources.id,
            set: {
              position,
              name: source.name,
              kind: source.kind ?? inferSourceKind(source.url),
              url: source.url,
              scrapeConfig: source.scrape ? JSON.stringify(source.scrape) : null,
              updatedAt: now,
            },
          })
          .run();

        tx.insert(feedSourceStates)
          .values({
            feedSourceId: source.id!,
            status: "active",
            errorCount: 0,
          })
          .onConflictDoNothing()
          .run();

        tx.delete(feedSourceTags).where(eq(feedSourceTags.feedSourceId, source.id!)).run();
        for (const tag of source.tags ?? []) {
          tx.insert(feedSourceTags)
            .values({ feedSourceId: source.id!, tag })
            .onConflictDoNothing()
            .run();
        }
      }

      for (const persisted of persistedSources) {
        if (!sourceIds.has(persisted.id)) {
          tx.delete(feedSources).where(eq(feedSources.id, persisted.id)).run();
        }
      }
    });

    return this.getFeedByName(feed.name)!;
  }

  removeFeed(name: string): void {
    this.db.delete(feeds).where(eq(feeds.name, name)).run();
  }

  listFeedStates(): FeedState[] {
    const rows = this.feedStateQuery() as FeedStateRow[];
    return rows.map((row) => this.toFeedState(row));
  }

  getFeedByName(name: string): FeedState | null {
    const row = this.feedStateQuery(name)[0] ?? null;
    return row ? this.toFeedState(row) : null;
  }

  listFeedSources(feedId: string): FeedSourceState[] {
    const rows = this.sqlite
      .query(
        `SELECT
           fs.id,
           fs.feed_id as feedId,
           fs.name,
           fs.kind,
           fs.url,
           fs.position,
           (
             SELECT json_group_array(tag)
             FROM (
               SELECT fst.tag
               FROM feed_source_tags fst
               WHERE fst.feed_source_id = fs.id
               ORDER BY fst.tag ASC
             )
           ) as tags,
           fss.last_scanned_at as lastScannedAt,
           fss.last_article_at as lastArticleAt,
           fss.error_count as errorCount,
           fss.status,
           fss.last_error as lastError
         FROM feed_sources fs
         LEFT JOIN feed_source_states fss ON fss.feed_source_id = fs.id
         WHERE fs.feed_id = ?
         ORDER BY fs.position ASC, fs.created_at ASC, fs.id ASC`,
      )
      .all(feedId) as FeedSourceStateRow[];

    return rows.map((row) => this.toFeedSourceState(row));
  }

  markSourceScanSuccess(
    feedSourceId: string,
    scannedAt: string,
    lastArticleAt: string | null,
  ): void {
    this.db
      .update(feedSourceStates)
      .set({
        status: "active",
        errorCount: 0,
        lastScannedAt: scannedAt,
        lastArticleAt: lastArticleAt ?? undefined,
        lastError: null,
      })
      .where(eq(feedSourceStates.feedSourceId, feedSourceId))
      .run();
  }

  markSourceScanError(
    feedSourceId: string,
    scannedAt: string,
    errorMessage: string,
  ): void {
    const current = this.db
      .select()
      .from(feedSourceStates)
      .where(eq(feedSourceStates.feedSourceId, feedSourceId))
      .get();

    this.db
      .insert(feedSourceStates)
      .values({
        feedSourceId,
        status: "error",
        errorCount: 1,
        lastScannedAt: scannedAt,
        lastError: errorMessage,
      })
      .onConflictDoUpdate({
        target: feedSourceStates.feedSourceId,
        set: {
          status: "error",
          errorCount: (current?.errorCount ?? 0) + 1,
          lastScannedAt: scannedAt,
          lastError: errorMessage,
        },
      })
      .run();
  }

  insertArticle(
    input: InsertArticleInput,
  ): { inserted: boolean; id: string | null } {
    const now = new Date().toISOString();
    const feedSourceId = input.feedSourceId ?? this.getPrimarySourceId(input.feedId);
    if (!feedSourceId) {
      throw new Error(`No feed source found for feed ${input.feedId}`);
    }

    const dedupHash = input.dedupHash ?? null;
    const canonicalUrl = normalizeCanonicalUrl(input.url);

    return this.db.transaction((tx) => {
      const existingOccurrence = tx
        .select({ id: articleOccurrences.id })
        .from(articleOccurrences)
        .where(
          and(
            eq(articleOccurrences.feedSourceId, feedSourceId),
            eq(articleOccurrences.sourceUrl, input.url),
          ),
        )
        .get();

      if (existingOccurrence) {
        return { inserted: false, id: null };
      }

      const existingCanonical =
        (dedupHash
          ? tx
              .select()
              .from(canonicalArticles)
              .where(eq(canonicalArticles.dedupHash, dedupHash))
              .get()
          : undefined) ??
        tx
          .select()
          .from(canonicalArticles)
          .where(
            dedupHash
              ? eq(canonicalArticles.canonicalUrl, canonicalUrl)
              : and(
                  eq(canonicalArticles.canonicalUrl, canonicalUrl),
                  isNull(canonicalArticles.dedupHash),
                ),
          )
          .get();

      const canonicalId = existingCanonical?.id ?? createId();

      if (!existingCanonical) {
        tx.insert(canonicalArticles)
          .values({
            id: canonicalId,
            canonicalUrl,
            dedupHash,
            title: input.title,
            summary: input.summary ?? null,
            content: input.content ?? null,
            language: input.language ?? null,
            publishedAt: input.publishedAt ?? null,
            updatedAt: input.updatedAt ?? null,
            firstDiscoveredAt: input.discoveredAt,
            lastSeenAt: input.discoveredAt,
            createdAt: now,
            updatedRecordAt: now,
          })
          .run();
      } else {
        tx.update(canonicalArticles)
          .set({
            title: choosePreferredText(existingCanonical.title, input.title),
            summary: choosePreferredNullableText(
              existingCanonical.summary,
              input.summary,
            ),
            content: choosePreferredNullableText(
              existingCanonical.content,
              input.content,
            ),
            language: existingCanonical.language ?? input.language ?? null,
            publishedAt: existingCanonical.publishedAt ?? input.publishedAt ?? null,
            updatedAt: input.updatedAt ?? existingCanonical.updatedAt,
            lastSeenAt: input.discoveredAt,
            updatedRecordAt: now,
          })
          .where(eq(canonicalArticles.id, canonicalId))
          .run();
      }

      const occurrenceId = createId();
      tx.insert(articleOccurrences)
        .values({
          id: occurrenceId,
          canonicalArticleId: canonicalId,
          feedId: input.feedId,
          feedSourceId,
          sourceUrl: input.url,
          externalId: input.externalId ?? null,
          title: input.title,
          summary: input.summary ?? null,
          content: input.content ?? null,
          authors: JSON.stringify(input.authors ?? []),
          categories: JSON.stringify(input.categories ?? []),
          attachments: JSON.stringify(input.attachments ?? []),
          publishedAt: input.publishedAt ?? null,
          updatedAt: input.updatedAt ?? null,
          discoveredAt: input.discoveredAt,
          language: input.language ?? null,
          sourceFormat: input.sourceFormat,
          createdAt: now,
          updatedRecordAt: now,
        })
        .run();

      for (const tag of input.tags ?? []) {
        tx.insert(articleTags)
          .values({ canonicalArticleId: canonicalId, tag })
          .onConflictDoNothing()
          .run();
      }

      return { inserted: true, id: occurrenceId };
    });
  }

  listArticles(filters: ListArticleFilters): Article[] {
    const params: Array<string | number> = [];
    const clauses: string[] = [];
    const joins = [
      "JOIN canonical_articles c ON c.id = ao.canonical_article_id",
      "LEFT JOIN article_states s ON s.canonical_article_id = c.id",
      "JOIN feeds f ON f.id = ao.feed_id",
    ];

    if (filters.unread) {
      clauses.push("s.read_at IS NULL");
    }
    if (filters.feedId) {
      clauses.push("ao.feed_id = ?");
      params.push(filters.feedId);
    }
    if (filters.feedName) {
      clauses.push("f.name = ?");
      params.push(filters.feedName);
    }
    if (filters.tag) {
      joins.push("JOIN article_tags t ON t.canonical_article_id = c.id");
      clauses.push("t.tag = ?");
      params.push(filters.tag);
    }
    if (filters.search) {
      joins.push("JOIN article_occurrences_fts fts ON fts.rowid = ao.rowid");
      clauses.push("article_occurrences_fts MATCH ?");
      params.push(filters.search);
    }
    if (filters.since) {
      clauses.push("COALESCE(ao.published_at, ao.discovered_at) >= ?");
      params.push(filters.since);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limitClause = filters.limit ? `LIMIT ${Number(filters.limit)}` : "";

    const rows = this.sqlite
      .query(
        `SELECT DISTINCT
           ao.id,
           ao.canonical_article_id as canonicalId,
           ao.feed_id as feedId,
           ao.feed_source_id as feedSourceId,
           ao.source_url as url,
           ao.external_id as externalId,
           ao.title,
           ao.summary,
           ao.content,
           ao.authors,
           ao.categories,
           ao.attachments,
           ao.published_at as publishedAt,
           ao.updated_at as updatedAt,
           ao.discovered_at as discoveredAt,
           ao.language,
           ao.source_format as sourceFormat,
           s.read_at as readAt
         FROM article_occurrences ao
         ${joins.join(" ")}
         ${whereClause}
         ORDER BY COALESCE(ao.published_at, ao.discovered_at) DESC, ao.discovered_at DESC
         ${limitClause}`,
      )
      .all(...params) as ArticleListRow[];

    return rows.map((row) => this.toArticle(row));
  }

  markArticleRead(id: string): boolean {
    const occurrence = this.db
      .select({
        canonicalId: articleOccurrences.canonicalArticleId,
      })
      .from(articleOccurrences)
      .where(eq(articleOccurrences.id, id))
      .get();

    if (!occurrence) return false;

    const existingState = this.db
      .select()
      .from(articleStates)
      .where(eq(articleStates.canonicalArticleId, occurrence.canonicalId))
      .get();

    if (existingState?.readAt) return false;

    const now = new Date().toISOString();
    this.db
      .insert(articleStates)
      .values({
        canonicalArticleId: occurrence.canonicalId,
        readAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: articleStates.canonicalArticleId,
        set: {
          readAt: now,
          updatedAt: now,
        },
      })
      .run();

    return true;
  }

  markAllRead(feedName?: string): number {
    const where = feedName
      ? "JOIN feeds f ON f.id = ao.feed_id WHERE f.name = ? AND s.read_at IS NULL"
      : "WHERE s.read_at IS NULL";
    const params = feedName ? [feedName] : [];

    const unreadRows = this.sqlite
      .query(
        `SELECT ao.canonical_article_id as canonicalId, COUNT(*) as occurrences
         FROM article_occurrences ao
         LEFT JOIN article_states s ON s.canonical_article_id = ao.canonical_article_id
         ${where}
         GROUP BY ao.canonical_article_id`,
      )
      .all(...params) as Array<{ canonicalId: string; occurrences: number }>;

    const unreadCount = unreadRows.reduce(
      (sum, row) => sum + Number(row.occurrences),
      0,
    );
    if (unreadCount === 0) return 0;

    const now = new Date().toISOString();
    this.db.transaction((tx) => {
      for (const row of unreadRows) {
        tx.insert(articleStates)
          .values({
            canonicalArticleId: row.canonicalId,
            readAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: articleStates.canonicalArticleId,
            set: {
              readAt: now,
              updatedAt: now,
            },
          })
          .run();
      }
    });

    return unreadCount;
  }

  private getPrimarySourceId(feedId: string): string | null {
    const source = this.db
      .select({ id: feedSources.id })
      .from(feedSources)
      .where(eq(feedSources.feedId, feedId))
      .orderBy(feedSources.position, feedSources.createdAt, feedSources.id)
      .get();
    return source?.id ?? null;
  }

  private feedStateQuery(name?: string): FeedStateRow[] {
    const params = name ? [name] : [];
    const whereClause = name ? "WHERE f.name = ?" : "";
    return this.sqlite.query(
      `SELECT
         f.id,
         f.name,
         (
           SELECT fs.id
           FROM feed_sources fs
           WHERE fs.feed_id = f.id
           ORDER BY fs.position ASC, fs.created_at ASC, fs.id ASC
           LIMIT 1
         ) as primarySourceId,
         (
           SELECT fs.name
           FROM feed_sources fs
           WHERE fs.feed_id = f.id
           ORDER BY fs.position ASC, fs.created_at ASC, fs.id ASC
           LIMIT 1
         ) as primarySourceName,
         (
           SELECT json_group_array(alias)
           FROM (
             SELECT fa.alias
             FROM feed_aliases fa
             WHERE fa.feed_id = f.id
             ORDER BY fa.alias ASC
           )
         ) as aliases,
         (
           SELECT COUNT(*)
           FROM feed_sources fs
           WHERE fs.feed_id = f.id
         ) as sourceCount,
         (
           SELECT MAX(fss.last_scanned_at)
           FROM feed_source_states fss
           JOIN feed_sources fs ON fs.id = fss.feed_source_id
           WHERE fs.feed_id = f.id
         ) as lastScannedAt,
         (
           SELECT MAX(fss.last_article_at)
           FROM feed_source_states fss
           JOIN feed_sources fs ON fs.id = fss.feed_source_id
           WHERE fs.feed_id = f.id
         ) as lastArticleAt,
         COALESCE((
           SELECT SUM(fss.error_count)
           FROM feed_source_states fss
           JOIN feed_sources fs ON fs.id = fss.feed_source_id
           WHERE fs.feed_id = f.id
         ), 0) as errorCount,
         CASE
           WHEN EXISTS (
             SELECT 1
             FROM feed_source_states fss
             JOIN feed_sources fs ON fs.id = fss.feed_source_id
             WHERE fs.feed_id = f.id AND fss.status = 'error'
           ) THEN 'error'
           WHEN EXISTS (
             SELECT 1
             FROM feed_source_states fss
             JOIN feed_sources fs ON fs.id = fss.feed_source_id
             WHERE fs.feed_id = f.id AND fss.status = 'active'
           ) THEN 'active'
           WHEN EXISTS (
             SELECT 1
             FROM feed_source_states fss
             JOIN feed_sources fs ON fs.id = fss.feed_source_id
             WHERE fs.feed_id = f.id AND fss.status = 'dead'
           ) THEN 'dead'
           ELSE 'active'
         END as status
       FROM feeds f
       ${whereClause}
       ORDER BY f.name ASC`,
    ).all(...params) as FeedStateRow[];
  }

  private toFeedState(row: FeedStateRow): FeedState {
    return {
      id: row.id,
      name: row.name,
      aliases: row.aliases ? (JSON.parse(row.aliases) as string[]) : [],
      sourceCount: Number(row.sourceCount),
      primarySourceId: row.primarySourceId,
      primarySourceName: row.primarySourceName,
      lastScannedAt: row.lastScannedAt,
      lastArticleAt: row.lastArticleAt,
      errorCount: Number(row.errorCount),
      status: row.status as FeedStatus,
    };
  }

  private toFeedSourceState(row: FeedSourceStateRow): FeedSourceState {
    return {
      id: row.id,
      feedId: row.feedId,
      name: row.name,
      kind: row.kind as FeedSourceKind,
      url: row.url,
      position: Number(row.position),
      tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
      lastScannedAt: row.lastScannedAt,
      lastArticleAt: row.lastArticleAt,
      errorCount: Number(row.errorCount),
      status: row.status as FeedStatus,
      lastError: row.lastError,
    };
  }

  private toArticle(row: ArticleListRow): Article {
    const tags = this.db
      .select({ tag: articleTags.tag })
      .from(articleTags)
      .where(eq(articleTags.canonicalArticleId, row.canonicalId))
      .orderBy(articleTags.tag)
      .all()
      .map((tag) => tag.tag);

    return {
      id: row.id,
      canonicalId: row.canonicalId,
      feedId: row.feedId,
      feedSourceId: row.feedSourceId,
      url: row.url,
      externalId: row.externalId,
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
      publishedAt: row.publishedAt,
      updatedAt: row.updatedAt,
      discoveredAt: row.discoveredAt,
      language: row.language,
      sourceFormat: row.sourceFormat as SourceFormat,
      read: row.readAt !== null,
      tags,
      dedupHash: this.db
        .select({ dedupHash: canonicalArticles.dedupHash })
        .from(canonicalArticles)
        .where(eq(canonicalArticles.id, row.canonicalId))
        .get()?.dedupHash ?? null,
    };
  }
}

function choosePreferredText(existing: string, incoming: string): string {
  return existing.length >= incoming.length ? existing : incoming;
}

function choosePreferredNullableText(
  existing: string | null,
  incoming: string | null | undefined,
): string | null {
  if (!existing) return incoming ?? null;
  if (!incoming) return existing;
  return choosePreferredText(existing, incoming);
}

function inferSourceKind(url: string): FeedSourceKind {
  if (url.includes("/outbox")) return "activitypub";
  if (url.endsWith(".json")) return "json";
  if (url.endsWith(".rdf")) return "rdf";
  if (url.endsWith(".atom") || url.includes("/atom")) return "atom";
  return "rss";
}

function normalizeCanonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}
