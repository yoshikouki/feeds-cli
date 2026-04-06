import { join } from "node:path";
import { Database } from "bun:sqlite";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import type {
  Article,
  ArticleAttachment,
  ArticleAuthor,
  CycleLogEntry,
  CycleStatus,
  CycleTrigger,
  FeedDefinition,
  FeedGroup,
  FeedSourceState,
  FeedState,
  FeedStatus,
  InsertArticleInput,
  ScanLogEntry,
  SourceKind,
} from "../types";
import { createId } from "../types";
import { normalizeFeedDefinition } from "../config";
import {
  articleAuthors,
  articleCategories,
  articleContents,
  articleOccurrences,
  articleStates,
  articleTags,
  canonicalArticles,
  cycleLog,
  feedAliases,
  feedGroupMemberships,
  feedGroups,
  feeds,
  feedSourceStates,
  feedSources,
  feedSourceTags,
  scanLog,
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
        articleAuthors,
        articleCategories,
        articleContents,
        articleOccurrences,
        articleStates,
        articleTags,
        canonicalArticles,
        feedAliases,
        feedGroupMemberships,
        feedGroups,
        feeds,
        feedSourceStates,
        feedSources,
        feedSourceTags,
        cycleLog,
        scanLog,
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

  // ─── Feed CRUD ───

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

  // ─── Feed Groups ───

  createFeedGroup(
    name: string,
    parentId?: string | null,
    position?: number,
  ): FeedGroup {
    const id = createId();
    const now = new Date().toISOString();

    if (parentId) {
      this.validateNotDescendant(parentId, id);
    }

    this.db
      .insert(feedGroups)
      .values({
        id,
        name,
        parentId: parentId ?? null,
        position: position ?? 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return { id, name, parentId: parentId ?? null, position: position ?? 0 };
  }

  listFeedGroups(): FeedGroup[] {
    const rows = this.db
      .select()
      .from(feedGroups)
      .orderBy(feedGroups.position, feedGroups.name)
      .all();

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      position: row.position,
    }));
  }

  addFeedToGroup(
    feedId: string,
    groupId: string,
    position?: number,
  ): void {
    this.db
      .insert(feedGroupMemberships)
      .values({
        feedId,
        groupId,
        position: position ?? 0,
      })
      .onConflictDoNothing()
      .run();
  }

  removeFeedFromGroup(feedId: string, groupId: string): void {
    this.db
      .delete(feedGroupMemberships)
      .where(
        and(
          eq(feedGroupMemberships.feedId, feedId),
          eq(feedGroupMemberships.groupId, groupId),
        ),
      )
      .run();
  }

  // ─── Scan State ───

  markSourceScanSuccess(
    feedSourceId: string,
    scannedAt: string,
    lastArticleAt: string | null,
    articleCount?: number,
    durationMs?: number,
    cycleId?: string,
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

    this.db
      .insert(scanLog)
      .values({
        id: createId(),
        feedSourceId,
        cycleId: cycleId ?? null,
        scannedAt,
        status: "success",
        articleCount: articleCount ?? null,
        durationMs: durationMs ?? null,
      })
      .run();
  }

  markSourceScanError(
    feedSourceId: string,
    scannedAt: string,
    errorMessage: string,
    durationMs?: number,
    cycleId?: string,
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

    this.db
      .insert(scanLog)
      .values({
        id: createId(),
        feedSourceId,
        cycleId: cycleId ?? null,
        scannedAt,
        status: "error",
        errorMessage,
        durationMs: durationMs ?? null,
      })
      .run();
  }

  listScanLog(feedSourceId: string, limit?: number): ScanLogEntry[] {
    const rows = this.db
      .select()
      .from(scanLog)
      .where(eq(scanLog.feedSourceId, feedSourceId))
      .orderBy(sql`${scanLog.scannedAt} DESC`)
      .limit(limit ?? 100)
      .all();

    return rows.map((row) => ({
      id: row.id,
      feedSourceId: row.feedSourceId,
      scannedAt: row.scannedAt,
      status: row.status as "success" | "error",
      articleCount: row.articleCount,
      errorMessage: row.errorMessage,
      durationMs: row.durationMs,
      cycleId: row.cycleId,
    }));
  }

  // ─── Cycle Log ───

  insertCycleLog(triggeredBy: CycleTrigger): string {
    const id = createId();
    this.db
      .insert(cycleLog)
      .values({
        id,
        triggeredBy,
        status: "running",
        startedAt: new Date().toISOString(),
      })
      .run();
    return id;
  }

  finishCycleLog(
    cycleId: string,
    status: "success" | "error",
    durationMs: number,
    errorMessage?: string,
  ): void {
    this.db
      .update(cycleLog)
      .set({
        status,
        finishedAt: new Date().toISOString(),
        durationMs,
        errorMessage: errorMessage ?? null,
      })
      .where(eq(cycleLog.id, cycleId))
      .run();
  }

  listCycleLog(filters?: {
    limit?: number;
    since?: string;
  }): CycleLogEntry[] {
    const params: Array<string | number> = [];
    const clauses: string[] = [];

    if (filters?.since) {
      clauses.push("started_at >= ?");
      params.push(filters.since);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = filters?.limit ?? 20;

    const rows = this.sqlite
      .query(
        `SELECT id, triggered_by, status, started_at, finished_at, duration_ms, error_message
         FROM cycle_log
         ${where}
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(...params, limit) as Array<{
      id: string;
      triggered_by: string;
      status: string;
      started_at: string;
      finished_at: string | null;
      duration_ms: number | null;
      error_message: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      triggeredBy: row.triggered_by as CycleTrigger,
      status: row.status as CycleStatus,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms,
      errorMessage: row.error_message,
    }));
  }

  listScanLogAll(filters?: {
    feedName?: string;
    limit?: number;
    since?: string;
  }): ScanLogEntry[] {
    const params: Array<string | number> = [];
    const clauses: string[] = [];
    let join = "";

    if (filters?.feedName) {
      join =
        "JOIN feed_sources fs ON fs.id = sl.feed_source_id JOIN feeds f ON f.id = fs.feed_id";
      clauses.push("f.name = ?");
      params.push(filters.feedName);
    }

    if (filters?.since) {
      clauses.push("sl.scanned_at >= ?");
      params.push(filters.since);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = filters?.limit ?? 20;

    const rows = this.sqlite
      .query(
        `SELECT sl.id, sl.feed_source_id, sl.scanned_at, sl.status,
                sl.article_count, sl.error_message, sl.duration_ms, sl.cycle_id
         FROM scan_log sl
         ${join}
         ${where}
         ORDER BY sl.scanned_at DESC
         LIMIT ?`,
      )
      .all(...params, limit) as Array<{
      id: string;
      feed_source_id: string;
      scanned_at: string;
      status: string;
      article_count: number | null;
      error_message: string | null;
      duration_ms: number | null;
      cycle_id: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      feedSourceId: row.feed_source_id,
      scannedAt: row.scanned_at,
      status: row.status as "success" | "error",
      articleCount: row.article_count,
      errorMessage: row.error_message,
      durationMs: row.duration_ms,
      cycleId: row.cycle_id,
    }));
  }

  pruneLogs(retainDays: number = 90): void {
    const cutoff = new Date(
      Date.now() - retainDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    this.sqlite.run(`DELETE FROM scan_log WHERE scanned_at < ?`, [cutoff]);
    this.sqlite.run(`DELETE FROM cycle_log WHERE started_at < ?`, [cutoff]);
  }

  // ─── Articles ───

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
    const contentValue = input.content ?? null;

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
        // New canonical article
        tx.insert(canonicalArticles)
          .values({
            id: canonicalId,
            canonicalUrl,
            dedupHash,
            title: input.title,
            summary: input.summary ?? null,
            language: input.language ?? null,
            publishedAt: input.publishedAt ?? null,
            updatedAt: input.updatedAt ?? null,
            firstDiscoveredAt: input.discoveredAt,
            lastSeenAt: input.discoveredAt,
            createdAt: now,
            updatedRecordAt: now,
          })
          .run();

        // Content in separate table
        tx.insert(articleContents)
          .values({
            canonicalArticleId: canonicalId,
            content: contentValue,
            updatedAt: now,
          })
          .run();

        // FTS index
        this.ftsInsert(canonicalId, input.title, input.summary ?? null, contentValue);
      } else {
        // Update existing canonical
        const existingContent = tx
          .select({ content: articleContents.content })
          .from(articleContents)
          .where(eq(articleContents.canonicalArticleId, canonicalId))
          .get();

        const mergedSummary = choosePreferredNullableText(
          existingCanonical.summary,
          input.summary,
        );
        const mergedContent = choosePreferredNullableText(
          existingContent?.content ?? null,
          contentValue,
        );

        tx.update(canonicalArticles)
          .set({
            title: choosePreferredText(existingCanonical.title, input.title),
            summary: mergedSummary,
            language: existingCanonical.language ?? input.language ?? null,
            publishedAt: existingCanonical.publishedAt ?? input.publishedAt ?? null,
            updatedAt: input.updatedAt ?? existingCanonical.updatedAt,
            lastSeenAt: input.discoveredAt,
            updatedRecordAt: now,
          })
          .where(eq(canonicalArticles.id, canonicalId))
          .run();

        // Update content
        tx.insert(articleContents)
          .values({
            canonicalArticleId: canonicalId,
            content: mergedContent,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: articleContents.canonicalArticleId,
            set: {
              content: mergedContent,
              updatedAt: now,
            },
          })
          .run();

        // Update FTS
        this.ftsDelete(canonicalId);
        this.ftsInsert(
          canonicalId,
          choosePreferredText(existingCanonical.title, input.title),
          mergedSummary,
          mergedContent,
        );
      }

      // Normalized authors (delete-and-reinsert)
      tx.delete(articleAuthors)
        .where(eq(articleAuthors.canonicalArticleId, canonicalId))
        .run();
      for (const [position, author] of (input.authors ?? []).entries()) {
        tx.insert(articleAuthors)
          .values({
            id: createId(),
            canonicalArticleId: canonicalId,
            name: author.name,
            url: author.url ?? null,
            email: author.email ?? null,
            position,
          })
          .run();
      }

      // Normalized categories (merge with onConflictDoNothing)
      for (const category of input.categories ?? []) {
        tx.insert(articleCategories)
          .values({ canonicalArticleId: canonicalId, category })
          .onConflictDoNothing()
          .run();
      }

      // Occurrence (source-level fidelity)
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
          content: contentValue,
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

      // Tags
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
      joins.push(
        "JOIN canonical_articles_fts fts ON fts.canonical_article_id = c.id",
      );
      clauses.push("canonical_articles_fts MATCH ?");
      params.push(`"${filters.search.replace(/"/g, '""')}"`);
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

  getArticleContent(canonicalArticleId: string): string | null {
    const row = this.db
      .select({ content: articleContents.content })
      .from(articleContents)
      .where(eq(articleContents.canonicalArticleId, canonicalArticleId))
      .get();
    return row?.content ?? null;
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

  // ─── FTS Management ───

  private ftsInsert(
    canonicalArticleId: string,
    title: string,
    summary: string | null,
    content: string | null,
  ): void {
    this.sqlite.run(
      `INSERT INTO canonical_articles_fts(canonical_article_id, title, summary, content) VALUES (?, ?, ?, ?)`,
      [canonicalArticleId, title, summary ?? "", content ?? ""],
    );
  }

  private ftsDelete(canonicalArticleId: string): void {
    this.sqlite.run(
      `DELETE FROM canonical_articles_fts WHERE canonical_article_id = ?`,
      [canonicalArticleId],
    );
  }

  // ─── Private Helpers ───

  private getPrimarySourceId(feedId: string): string | null {
    const source = this.db
      .select({ id: feedSources.id })
      .from(feedSources)
      .where(eq(feedSources.feedId, feedId))
      .orderBy(feedSources.position, feedSources.createdAt, feedSources.id)
      .get();
    return source?.id ?? null;
  }

  private validateNotDescendant(
    parentId: string,
    targetId: string,
  ): void {
    const visited = new Set<string>();
    let current: string | null = parentId;
    while (current) {
      if (current === targetId) {
        throw new Error("Circular feed group reference detected");
      }
      if (visited.has(current)) break;
      visited.add(current);
      const parent = this.db
        .select({ parentId: feedGroups.parentId })
        .from(feedGroups)
        .where(eq(feedGroups.id, current))
        .get();
      current = parent?.parentId ?? null;
    }
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

  getArticleByOccurrenceId(id: string): Article | null {
    const isPrefix = id.length < 36;
    const escapedId = isPrefix
      ? id.replace(/[%_]/g, (ch) => `\\${ch}`)
      : id;
    const rows = this.sqlite
      .query(
        `SELECT
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
         JOIN canonical_articles c ON c.id = ao.canonical_article_id
         LEFT JOIN article_states s ON s.canonical_article_id = c.id
         WHERE ${isPrefix ? "ao.id LIKE ? || '%' ESCAPE '\\'" : "ao.id = ?"}`,
      )
      .all(escapedId) as ArticleListRow[];

    if (isPrefix && rows.length > 1) {
      throw new Error(`Ambiguous ID prefix "${id}" matches ${rows.length} articles. Use a longer prefix.`);
    }

    const row = rows[0];
    if (!row) return null;
    return this.toArticle(row);
  }

  private toFeedSourceState(row: FeedSourceStateRow): FeedSourceState {
    return {
      id: row.id,
      feedId: row.feedId,
      name: row.name,
      kind: row.kind as SourceKind,
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
      sourceFormat: row.sourceFormat as SourceKind,
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

function inferSourceKind(url: string): SourceKind {
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
