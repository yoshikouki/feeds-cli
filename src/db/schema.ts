import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const feeds = sqliteTable(
  "feeds",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("feeds_name_unique").on(table.name)],
);

export const feedAliases = sqliteTable(
  "feed_aliases",
  {
    feedId: text("feed_id")
      .notNull()
      .references(() => feeds.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.feedId, table.alias] }),
    uniqueIndex("feed_aliases_alias_unique").on(table.alias),
  ],
);

export const feedSources = sqliteTable(
  "feed_sources",
  {
    id: text("id").primaryKey(),
    feedId: text("feed_id")
      .notNull()
      .references(() => feeds.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: text("kind").notNull(),
    url: text("url").notNull(),
    scrapeConfig: text("scrape_config"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("feed_sources_feed_url_unique").on(table.feedId, table.url),
    uniqueIndex("feed_sources_feed_position_unique").on(
      table.feedId,
      table.position,
    ),
    index("feed_sources_feed_idx").on(table.feedId),
  ],
);

export const feedSourceTags = sqliteTable(
  "feed_source_tags",
  {
    feedSourceId: text("feed_source_id")
      .notNull()
      .references(() => feedSources.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.feedSourceId, table.tag] }),
    index("feed_source_tags_tag_idx").on(table.tag),
  ],
);

export const feedSourceStates = sqliteTable(
  "feed_source_states",
  {
    feedSourceId: text("feed_source_id")
      .primaryKey()
      .references(() => feedSources.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    errorCount: integer("error_count").notNull().default(0),
    lastScannedAt: text("last_scanned_at"),
    lastArticleAt: text("last_article_at"),
    lastError: text("last_error"),
  },
);

export const canonicalArticles = sqliteTable(
  "canonical_articles",
  {
    id: text("id").primaryKey(),
    canonicalUrl: text("canonical_url").notNull(),
    dedupHash: text("dedup_hash"),
    title: text("title").notNull(),
    summary: text("summary"),
    content: text("content"),
    language: text("language"),
    publishedAt: text("published_at"),
    updatedAt: text("updated_at"),
    firstDiscoveredAt: text("first_discovered_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedRecordAt: text("updated_record_at").notNull(),
  },
  (table) => [
    uniqueIndex("canonical_articles_dedup_hash_unique")
      .on(table.dedupHash)
      .where(sql`${table.dedupHash} IS NOT NULL`),
    index("canonical_articles_published_idx").on(table.publishedAt),
  ],
);

export const articleOccurrences = sqliteTable(
  "article_occurrences",
  {
    id: text("id").primaryKey(),
    canonicalArticleId: text("canonical_article_id")
      .notNull()
      .references(() => canonicalArticles.id, { onDelete: "cascade" }),
    feedId: text("feed_id")
      .notNull()
      .references(() => feeds.id, { onDelete: "cascade" }),
    feedSourceId: text("feed_source_id")
      .notNull()
      .references(() => feedSources.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url").notNull(),
    externalId: text("external_id"),
    title: text("title").notNull(),
    summary: text("summary"),
    content: text("content"),
    authors: text("authors"),
    categories: text("categories"),
    attachments: text("attachments"),
    publishedAt: text("published_at"),
    updatedAt: text("updated_at"),
    discoveredAt: text("discovered_at").notNull(),
    language: text("language"),
    sourceFormat: text("source_format").notNull(),
    createdAt: text("created_at").notNull(),
    updatedRecordAt: text("updated_record_at").notNull(),
  },
  (table) => [
    uniqueIndex("article_occurrences_source_unique").on(
      table.feedSourceId,
      table.sourceUrl,
    ),
    index("article_occurrences_feed_idx").on(table.feedId),
    index("article_occurrences_canonical_idx").on(table.canonicalArticleId),
    index("article_occurrences_discovered_idx").on(table.discoveredAt),
  ],
);

export const articleTags = sqliteTable(
  "article_tags",
  {
    canonicalArticleId: text("canonical_article_id")
      .notNull()
      .references(() => canonicalArticles.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.canonicalArticleId, table.tag] }),
    index("article_tags_tag_idx").on(table.tag),
  ],
);

export const articleStates = sqliteTable("article_states", {
  canonicalArticleId: text("canonical_article_id")
    .primaryKey()
    .references(() => canonicalArticles.id, { onDelete: "cascade" }),
  readAt: text("read_at"),
  archivedAt: text("archived_at"),
  starredAt: text("starred_at"),
  updatedAt: text("updated_at").notNull(),
});
