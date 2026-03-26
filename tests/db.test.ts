import { describe, test, expect } from "bun:test";
import { eq } from "drizzle-orm";
import { FeedDatabase } from "../src/db";
import { feedGroups } from "../src/db/schema";
import type { InsertArticleInput } from "../src/types";

function createTestDb(): FeedDatabase {
  return new FeedDatabase(":memory:");
}

function insertTestArticle(
  db: FeedDatabase,
  feedId: string,
  feedSourceId: string,
  overrides: Partial<InsertArticleInput> = {},
): { inserted: boolean; id: string | null } {
  return db.insertArticle({
    feedId,
    feedSourceId,
    url: "https://example.com/post",
    title: "Test Post",
    discoveredAt: "2025-01-01T00:00:00Z",
    sourceFormat: "rss",
    ...overrides,
  });
}

describe("FeedDatabase", () => {
  describe("Disposable", () => {
    test("supports using pattern", () => {
      let dbRef: FeedDatabase;
      {
        using db = createTestDb();
        dbRef = db;
        db.upsertFeedFromConfig({
          name: "Test",
          sources: [{ name: "main", url: "https://example.com" }],
        });
        expect(db.listFeedStates()).toHaveLength(1);
      }
      expect(() => dbRef!.listFeedStates()).toThrow();
    });
  });

  describe("feed operations", () => {
    test("upsertFeedFromConfig creates feed with UUID", () => {
      using db = createTestDb();
      const feed = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ name: "main", url: "https://hn.com/rss" }],
      });

      expect(feed.id).toBeString();
      expect(feed.id.length).toBeGreaterThan(0);
      expect(feed.name).toBe("HN");
      expect(feed.primarySourceId).toBeString();
      expect(feed.primarySourceName).toBe("main");
      expect(feed.status).toBe("active");
      expect(feed.errorCount).toBe(0);
    });

    test("upsert and list feeds", () => {
      using db = createTestDb();
      db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ name: "main", url: "https://hn.com/rss" }],
      });
      db.upsertFeedFromConfig({
        name: "Lobsters",
        sources: [{ name: "main", url: "https://lobste.rs/rss" }],
      });

      const feeds = db.listFeedStates();
      expect(feeds).toHaveLength(2);
      expect(feeds[0].name).toBe("HN");
      expect(feeds[0].status).toBe("active");
      expect(feeds[0].id).toBeString();
      expect(feeds[1].name).toBe("Lobsters");
    });

    test("feed state aggregates multiple sources", () => {
      using db = createTestDb();
      db.upsertFeedFromConfig({
        name: "Platform",
        sources: [
          { name: "rss", url: "https://example.com/rss", kind: "rss" },
          { name: "json", url: "https://example.com/feed.json", kind: "json" },
        ],
      });

      const feed = db.getFeedByName("Platform");
      expect(feed).not.toBeNull();
      expect(feed!.sourceCount).toBe(2);
      expect(feed!.primarySourceName).toBe("rss");
    });

    test("upsert updates sources by stable source id, preserves feed id", () => {
      using db = createTestDb();
      const first = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "source-main", name: "main", url: "https://old.com" }],
      });
      const second = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "source-main", name: "main", url: "https://new.com" }],
      });

      expect(second.id).toBe(first.id);
      const source = db.listFeedSources(first.id)[0];
      expect(source.id).toBe("source-main");
      expect(source.url).toBe("https://new.com");

      const feeds = db.listFeedStates();
      expect(feeds).toHaveLength(1);
      expect(feeds[0].primarySourceId).toBe("source-main");
    });

    test("getFeedByName returns feed or null", () => {
      using db = createTestDb();
      db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ name: "main", url: "https://hn.com/rss" }],
      });

      const found = db.getFeedByName("HN");
      expect(found).not.toBeNull();
      expect(found!.name).toBe("HN");

      const notFound = db.getFeedByName("missing");
      expect(notFound).toBeNull();
    });

    test("removeFeed cascades to articles and tags", () => {
      using db = createTestDb();
      const feed = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ name: "main", url: "https://hn.com/rss" }],
      });
      const source = db.listFeedSources(feed.id)[0];
      db.insertArticle({
        feedId: feed.id,
        feedSourceId: source.id,
        url: "https://example.com/1",
        title: "Article 1",
        discoveredAt: "2025-01-01T00:00:00Z",
        sourceFormat: "rss",
        tags: ["tech"],
      });

      db.removeFeed("HN");
      expect(db.listFeedStates()).toHaveLength(0);
      expect(db.listArticles({})).toHaveLength(0);
    });

    test("markSourceScanSuccess resets only that source error state", () => {
      using db = createTestDb();
      const feed = db.upsertFeedFromConfig({
        name: "HN",
        sources: [
          { id: "rss", name: "rss", url: "https://hn.com/rss" },
          { id: "json", name: "json", url: "https://hn.com/feed.json" },
        ],
      });
      db.markSourceScanError("rss", "2025-01-01T00:00:00Z", "timeout");
      db.markSourceScanError("rss", "2025-01-02T00:00:00Z", "timeout");
      db.markSourceScanError("json", "2025-01-02T00:00:00Z", "500");

      let feeds = db.listFeedStates();
      expect(feeds[0].errorCount).toBe(3);
      expect(feeds[0].status).toBe("error");

      db.markSourceScanSuccess(
        "rss",
        "2025-01-03T00:00:00Z",
        "2025-01-03T00:00:00Z",
      );
      feeds = db.listFeedStates();
      expect(feeds[0].errorCount).toBe(1);
      expect(feeds[0].status).toBe("error");
      expect(feeds[0].lastScannedAt).toBe("2025-01-03T00:00:00Z");
      expect(feeds[0].lastArticleAt).toBe("2025-01-03T00:00:00Z");

      const sources = db.listFeedSources(feed.id);
      expect(sources).toEqual([
        expect.objectContaining({
          id: "rss",
          status: "active",
          errorCount: 0,
          lastError: null,
        }),
        expect.objectContaining({
          id: "json",
          status: "error",
          errorCount: 1,
          lastError: "500",
        }),
      ]);
    });
  });

  describe("article operations", () => {
    test("insert and list articles with rich metadata", () => {
      using db = createTestDb();
      const feed = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "main", name: "main", url: "https://hn.com/rss" }],
      });

      const result = db.insertArticle({
        feedId: feed.id,
        feedSourceId: "main",
        url: "https://example.com/post",
        externalId: "guid-123",
        title: "Test Post",
        summary: "A summary",
        content: "Hello world",
        authors: [{ name: "Alice", url: "https://alice.example.com" }],
        categories: ["tech", "news"],
        attachments: [
          { url: "https://example.com/file.pdf", mimeType: "application/pdf" },
        ],
        publishedAt: "2025-01-15T12:00:00Z",
        updatedAt: "2025-01-16T00:00:00Z",
        discoveredAt: "2025-01-15T12:30:00Z",
        language: "en",
        sourceFormat: "rss",
        tags: ["tech"],
      });

      expect(result.inserted).toBe(true);
      expect(result.id).toBeString();

      const articles = db.listArticles({});
      expect(articles).toHaveLength(1);

      const a = articles[0];
      expect(a.title).toBe("Test Post");
      expect(a.externalId).toBe("guid-123");
      expect(a.summary).toBe("A summary");
      expect(a.content).toBe("Hello world");
      expect(a.authors).toEqual([
        { name: "Alice", url: "https://alice.example.com" },
      ]);
      expect(a.categories).toEqual(["tech", "news"]);
      expect(a.attachments).toEqual([
        { url: "https://example.com/file.pdf", mimeType: "application/pdf" },
      ]);
      expect(a.publishedAt).toBe("2025-01-15T12:00:00Z");
      expect(a.updatedAt).toBe("2025-01-16T00:00:00Z");
      expect(a.language).toBe("en");
      expect(a.sourceFormat).toBe("rss");
      expect(a.read).toBe(false);
      expect(a.tags).toEqual(["tech"]);
    });

    test("compound unique: same URL in different feeds succeeds", () => {
      using db = createTestDb();
      const hn = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "hn-main", name: "main", url: "https://hn.com/rss" }],
      });
      const lobsters = db.upsertFeedFromConfig({
        name: "Lobsters",
        sources: [{ id: "lob-main", name: "main", url: "https://lobste.rs/rss" }],
      });

      const first = insertTestArticle(db, hn.id, "hn-main");
      const second = insertTestArticle(db, lobsters.id, "lob-main");

      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(true);
      expect(db.listArticles({})).toHaveLength(2);
    });

    test("dedup hash links cross-feed occurrences to the same canonical read state", () => {
      using db = createTestDb();
      const hn = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "hn-main", name: "main", url: "https://hn.com/rss" }],
      });
      const lobsters = db.upsertFeedFromConfig({
        name: "Lobsters",
        sources: [{ id: "lob-main", name: "main", url: "https://lobste.rs/rss" }],
      });

      const first = insertTestArticle(db, hn.id, "hn-main", {
        url: "https://example.com/canonical-a",
        dedupHash: "same-article",
      });
      const second = insertTestArticle(db, lobsters.id, "lob-main", {
        url: "https://example.com/canonical-b",
        dedupHash: "same-article",
      });

      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(true);

      db.markArticleRead(first.id!);
      expect(db.listArticles({ unread: true })).toHaveLength(0);
    });

    test("compound unique: same URL in same feed is deduplicated", () => {
      using db = createTestDb();
      const feed = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "main", name: "main", url: "https://hn.com/rss" }],
      });

      const first = insertTestArticle(db, feed.id, "main");
      const second = insertTestArticle(db, feed.id, "main", { title: "Duplicate" });

      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
      expect(second.id).toBeNull();
      expect(db.listArticles({})).toHaveLength(1);
    });

    test("filter by unread", () => {
      using db = createTestDb();
      const feed = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "main", name: "main", url: "https://hn.com/rss" }],
      });

      const r1 = insertTestArticle(db, feed.id, "main", {
        url: "https://example.com/1",
        title: "One",
      });
      insertTestArticle(db, feed.id, "main", {
        url: "https://example.com/2",
        title: "Two",
      });

      db.markArticleRead(r1.id!);

      const unread = db.listArticles({ unread: true });
      expect(unread).toHaveLength(1);
      expect(unread[0].title).toBe("Two");
    });

    test("filter by feedName", () => {
      using db = createTestDb();
      const hn = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "hn-main", name: "main", url: "https://hn.com/rss" }],
      });
      const lobsters = db.upsertFeedFromConfig({
        name: "Lobsters",
        sources: [{ id: "lob-main", name: "main", url: "https://lobste.rs/rss" }],
      });

      insertTestArticle(db, hn.id, "hn-main", {
        url: "https://example.com/1",
        title: "HN Post",
      });
      insertTestArticle(db, lobsters.id, "lob-main", {
        url: "https://example.com/2",
        title: "Lobsters Post",
      });

      const articles = db.listArticles({ feedName: "HN" });
      expect(articles).toHaveLength(1);
      expect(articles[0].title).toBe("HN Post");
    });

    test("filter by tag", () => {
      using db = createTestDb();
      const feed = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "main", name: "main", url: "https://hn.com/rss" }],
      });

      insertTestArticle(db, feed.id, "main", {
        url: "https://example.com/1",
        title: "Tagged",
        tags: ["important"],
      });
      insertTestArticle(db, feed.id, "main", {
        url: "https://example.com/2",
        title: "Untagged",
      });

      const articles = db.listArticles({ tag: "important" });
      expect(articles).toHaveLength(1);
      expect(articles[0].title).toBe("Tagged");
    });

    test("filter by FTS search", () => {
      using db = createTestDb();
      const feed = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "main", name: "main", url: "https://hn.com/rss" }],
      });

      insertTestArticle(db, feed.id, "main", {
        url: "https://example.com/1",
        title: "TypeScript Guide",
        content: "Learn TypeScript from scratch",
      });
      insertTestArticle(db, feed.id, "main", {
        url: "https://example.com/2",
        title: "Rust Guide",
        content: "Learn Rust from scratch",
      });

      const articles = db.listArticles({ search: "TypeScript" });
      expect(articles).toHaveLength(1);
      expect(articles[0].title).toBe("TypeScript Guide");
    });

    test("filter by since", () => {
      using db = createTestDb();
      const feed = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "main", name: "main", url: "https://hn.com/rss" }],
      });

      insertTestArticle(db, feed.id, "main", {
        url: "https://example.com/old",
        title: "Old",
        publishedAt: "2025-01-01T00:00:00Z",
        discoveredAt: "2025-01-01T00:00:00Z",
      });
      insertTestArticle(db, feed.id, "main", {
        url: "https://example.com/new",
        title: "New",
        publishedAt: "2025-02-01T00:00:00Z",
        discoveredAt: "2025-02-01T00:00:00Z",
      });

      const recent = db.listArticles({ since: "2025-01-15T00:00:00Z" });
      expect(recent).toHaveLength(1);
      expect(recent[0].title).toBe("New");
    });

    test("limit results", () => {
      using db = createTestDb();
      const feed = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "main", name: "main", url: "https://hn.com/rss" }],
      });

      for (let i = 0; i < 5; i++) {
        insertTestArticle(db, feed.id, "main", {
          url: `https://example.com/${i}`,
          title: `Post ${i}`,
          discoveredAt: `2025-01-0${i + 1}T00:00:00Z`,
        });
      }

      expect(db.listArticles({ limit: 3 })).toHaveLength(3);
    });

    test("markAllRead marks all articles", () => {
      using db = createTestDb();
      const feed = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "main", name: "main", url: "https://hn.com/rss" }],
      });

      insertTestArticle(db, feed.id, "main", {
        url: "https://example.com/1",
        title: "One",
      });
      insertTestArticle(db, feed.id, "main", {
        url: "https://example.com/2",
        title: "Two",
      });

      const count = db.markAllRead();
      expect(count).toBe(2);
      expect(db.listArticles({ unread: true })).toHaveLength(0);
    });

    test("markAllRead by feed name", () => {
      using db = createTestDb();
      const hn = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "hn-main", name: "main", url: "https://hn.com/rss" }],
      });
      const lobsters = db.upsertFeedFromConfig({
        name: "Lobsters",
        sources: [{ id: "lob-main", name: "main", url: "https://lobste.rs/rss" }],
      });

      insertTestArticle(db, hn.id, "hn-main", {
        url: "https://example.com/1",
        title: "HN",
      });
      insertTestArticle(db, lobsters.id, "lob-main", {
        url: "https://example.com/2",
        title: "Lobsters",
      });

      db.markAllRead("HN");
      const unread = db.listArticles({ unread: true });
      expect(unread).toHaveLength(1);
      expect(unread[0].feedId).toBe(lobsters.id);
    });

    test("getArticleContent returns content from article_contents table", () => {
      using db = createTestDb();
      const feed = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "main", name: "main", url: "https://hn.com/rss" }],
      });

      const result = db.insertArticle({
        feedId: feed.id,
        feedSourceId: "main",
        url: "https://example.com/post",
        title: "Test Post",
        content: "Full article content here",
        discoveredAt: "2025-01-01T00:00:00Z",
        sourceFormat: "rss",
      });

      expect(result.inserted).toBe(true);

      const articles = db.listArticles({});
      expect(articles).toHaveLength(1);
      const content = db.getArticleContent(articles[0].canonicalId!);
      expect(content).toBe("Full article content here");
    });

    test("getArticleContent returns null for missing canonical id", () => {
      using db = createTestDb();
      expect(db.getArticleContent("nonexistent")).toBeNull();
    });
  });

  describe("normalized authors and categories", () => {
    test("insertArticle populates article_authors table", () => {
      using db = createTestDb();
      const feed = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "main", name: "main", url: "https://hn.com/rss" }],
      });

      db.insertArticle({
        feedId: feed.id,
        feedSourceId: "main",
        url: "https://example.com/post",
        title: "Test Post",
        authors: [
          { name: "Alice", url: "https://alice.example.com", email: "alice@example.com" },
          { name: "Bob" },
        ],
        discoveredAt: "2025-01-01T00:00:00Z",
        sourceFormat: "rss",
      });

      const rows = db.sqlite
        .query(
          `SELECT name, url, email, position
           FROM article_authors
           ORDER BY position ASC`,
        )
        .all() as Array<{ name: string; url: string | null; email: string | null; position: number }>;

      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({
        name: "Alice",
        url: "https://alice.example.com",
        email: "alice@example.com",
        position: 0,
      });
      expect(rows[1]).toEqual({
        name: "Bob",
        url: null,
        email: null,
        position: 1,
      });
    });

    test("insertArticle populates article_categories table", () => {
      using db = createTestDb();
      const feed = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "main", name: "main", url: "https://hn.com/rss" }],
      });

      db.insertArticle({
        feedId: feed.id,
        feedSourceId: "main",
        url: "https://example.com/post",
        title: "Test Post",
        categories: ["tech", "news", "ai"],
        discoveredAt: "2025-01-01T00:00:00Z",
        sourceFormat: "rss",
      });

      const rows = db.sqlite
        .query(
          `SELECT category FROM article_categories ORDER BY category ASC`,
        )
        .all() as Array<{ category: string }>;

      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.category)).toEqual(["ai", "news", "tech"]);
    });

    test("authors are replaced on duplicate canonical article", () => {
      using db = createTestDb();
      const hn = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "hn-main", name: "main", url: "https://hn.com/rss" }],
      });
      const lobsters = db.upsertFeedFromConfig({
        name: "Lobsters",
        sources: [{ id: "lob-main", name: "main", url: "https://lobste.rs/rss" }],
      });

      db.insertArticle({
        feedId: hn.id,
        feedSourceId: "hn-main",
        url: "https://example.com/same",
        title: "Shared Article",
        authors: [{ name: "Alice" }],
        dedupHash: "shared-hash",
        discoveredAt: "2025-01-01T00:00:00Z",
        sourceFormat: "rss",
      });

      db.insertArticle({
        feedId: lobsters.id,
        feedSourceId: "lob-main",
        url: "https://example.com/same-other-url",
        title: "Shared Article",
        authors: [{ name: "Bob" }, { name: "Charlie" }],
        dedupHash: "shared-hash",
        discoveredAt: "2025-01-02T00:00:00Z",
        sourceFormat: "rss",
      });

      const rows = db.sqlite
        .query(`SELECT name FROM article_authors ORDER BY position ASC`)
        .all() as Array<{ name: string }>;

      expect(rows).toHaveLength(2);
      expect(rows[0].name).toBe("Bob");
      expect(rows[1].name).toBe("Charlie");
    });
  });

  describe("feed groups", () => {
    test("create and list feed groups", () => {
      using db = createTestDb();
      const group = db.createFeedGroup("Tech");
      expect(group.id).toBeString();
      expect(group.name).toBe("Tech");
      expect(group.parentId).toBeNull();
      expect(group.position).toBe(0);

      const groups = db.listFeedGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0].name).toBe("Tech");
    });

    test("nested groups with parent_id", () => {
      using db = createTestDb();
      const parent = db.createFeedGroup("Tech");
      const child = db.createFeedGroup("Rust", parent.id, 0);

      expect(child.parentId).toBe(parent.id);

      const groups = db.listFeedGroups();
      expect(groups).toHaveLength(2);
    });

    test("add and remove feed from group", () => {
      using db = createTestDb();
      const group = db.createFeedGroup("Tech");
      const feed = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ name: "main", url: "https://hn.com/rss" }],
      });

      db.addFeedToGroup(feed.id, group.id);

      const memberships = db.sqlite
        .query(`SELECT feed_id, group_id FROM feed_group_memberships`)
        .all() as Array<{ feed_id: string; group_id: string }>;
      expect(memberships).toHaveLength(1);
      expect(memberships[0].feed_id).toBe(feed.id);
      expect(memberships[0].group_id).toBe(group.id);

      db.removeFeedFromGroup(feed.id, group.id);
      const after = db.sqlite
        .query(`SELECT * FROM feed_group_memberships`)
        .all();
      expect(after).toHaveLength(0);
    });

    test("cascade delete removes child groups", () => {
      using db = createTestDb();
      const parent = db.createFeedGroup("Tech");
      db.createFeedGroup("Rust", parent.id);

      db.db.delete(feedGroups).where(eq(feedGroups.id, parent.id)).run();

      const groups = db.listFeedGroups();
      expect(groups).toHaveLength(0);
    });
  });

  describe("scan log", () => {
    test("markSourceScanSuccess writes to scan_log", () => {
      using db = createTestDb();
      const feed = db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "main", name: "main", url: "https://hn.com/rss" }],
      });

      db.markSourceScanSuccess("main", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", 5, 120);

      const logs = db.listScanLog("main");
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe("success");
      expect(logs[0].articleCount).toBe(5);
      expect(logs[0].durationMs).toBe(120);
      expect(logs[0].errorMessage).toBeNull();
    });

    test("markSourceScanError writes to scan_log", () => {
      using db = createTestDb();
      db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "main", name: "main", url: "https://hn.com/rss" }],
      });

      db.markSourceScanError("main", "2025-01-01T00:00:00Z", "timeout", 500);

      const logs = db.listScanLog("main");
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe("error");
      expect(logs[0].errorMessage).toBe("timeout");
      expect(logs[0].durationMs).toBe(500);
    });

    test("scan_log accumulates history", () => {
      using db = createTestDb();
      db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "main", name: "main", url: "https://hn.com/rss" }],
      });

      db.markSourceScanSuccess("main", "2025-01-01T00:00:00Z", null, 3);
      db.markSourceScanError("main", "2025-01-02T00:00:00Z", "500");
      db.markSourceScanSuccess("main", "2025-01-03T00:00:00Z", "2025-01-03T00:00:00Z", 7);

      const logs = db.listScanLog("main");
      expect(logs).toHaveLength(3);
      expect(logs[0].scannedAt).toBe("2025-01-03T00:00:00Z");
      expect(logs[0].status).toBe("success");
      expect(logs[1].status).toBe("error");
      expect(logs[2].status).toBe("success");
    });

    test("listScanLog respects limit", () => {
      using db = createTestDb();
      db.upsertFeedFromConfig({
        name: "HN",
        sources: [{ id: "main", name: "main", url: "https://hn.com/rss" }],
      });

      for (let i = 0; i < 5; i++) {
        db.markSourceScanSuccess("main", `2025-01-0${i + 1}T00:00:00Z`, null, i);
      }

      const logs = db.listScanLog("main", 2);
      expect(logs).toHaveLength(2);
    });
  });
});
