import { describe, test, expect } from "bun:test";
import { FeedDatabase } from "../src/db";
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
  });
});
