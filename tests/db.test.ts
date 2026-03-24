import { describe, test, expect } from "bun:test";
import { FeedDatabase } from "../src/db";

function createTestDb(): FeedDatabase {
  return new FeedDatabase(":memory:");
}

describe("FeedDatabase", () => {
  describe("Disposable", () => {
    test("supports using pattern", () => {
      let dbRef: FeedDatabase;
      {
        using db = createTestDb();
        dbRef = db;
        db.upsertFeedDefinition({ name: "Test", url: "https://example.com" });
        expect(db.listFeedStates()).toHaveLength(1);
      }
      // After dispose, db should be closed
      expect(() => dbRef!.listFeedStates()).toThrow();
    });
  });

  describe("feed operations", () => {
    test("upsert and list feeds", () => {
      using db = createTestDb();
      db.upsertFeedDefinition({ name: "HN", url: "https://hn.com/rss" });
      db.upsertFeedDefinition({
        name: "Lobsters",
        url: "https://lobste.rs/rss",
      });

      const feeds = db.listFeedStates();
      expect(feeds).toHaveLength(2);
      expect(feeds[0].name).toBe("HN");
      expect(feeds[0].status).toBe("active");
      expect(feeds[0].errorCount).toBe(0);
      expect(feeds[1].name).toBe("Lobsters");
    });

    test("upsert updates url on conflict", () => {
      using db = createTestDb();
      db.upsertFeedDefinition({ name: "HN", url: "https://old.com" });
      db.upsertFeedDefinition({ name: "HN", url: "https://new.com" });

      const feeds = db.listFeedStates();
      expect(feeds).toHaveLength(1);
      expect(feeds[0].url).toBe("https://new.com");
    });

    test("removeFeed deletes feed and its articles", () => {
      using db = createTestDb();
      db.upsertFeedDefinition({ name: "HN", url: "https://hn.com/rss" });
      db.insertArticle({
        feedName: "HN",
        url: "https://example.com/1",
        title: "Article 1",
        discoveredAt: "2025-01-01T00:00:00Z",
      });

      db.removeFeed("HN");
      expect(db.listFeedStates()).toHaveLength(0);
      expect(db.listArticles({})).toHaveLength(0);
    });

    test("markFeedScanSuccess resets error state", () => {
      using db = createTestDb();
      db.upsertFeedDefinition({ name: "HN", url: "https://hn.com/rss" });
      db.markFeedScanError("HN", "2025-01-01T00:00:00Z");
      db.markFeedScanError("HN", "2025-01-02T00:00:00Z");

      let feeds = db.listFeedStates();
      expect(feeds[0].errorCount).toBe(2);
      expect(feeds[0].status).toBe("error");

      db.markFeedScanSuccess("HN", "2025-01-03T00:00:00Z", "2025-01-03T00:00:00Z");
      feeds = db.listFeedStates();
      expect(feeds[0].errorCount).toBe(0);
      expect(feeds[0].status).toBe("active");
      expect(feeds[0].lastScannedAt).toBe("2025-01-03T00:00:00Z");
      expect(feeds[0].lastArticleAt).toBe("2025-01-03T00:00:00Z");
    });
  });

  describe("article operations", () => {
    test("insert and list articles", () => {
      using db = createTestDb();
      db.upsertFeedDefinition({ name: "HN", url: "https://hn.com/rss" });

      const result = db.insertArticle({
        feedName: "HN",
        url: "https://example.com/post",
        title: "Test Post",
        content: "Hello world",
        publishedAt: "2025-01-15T12:00:00Z",
        discoveredAt: "2025-01-15T12:30:00Z",
        tags: ["tech"],
      });

      expect(result.inserted).toBe(true);
      expect(result.id).toBeString();

      const articles = db.listArticles({});
      expect(articles).toHaveLength(1);
      expect(articles[0].title).toBe("Test Post");
      expect(articles[0].read).toBe(false);
      expect(articles[0].tags).toEqual(["tech"]);
    });

    test("dedup by URL (INSERT OR IGNORE)", () => {
      using db = createTestDb();
      db.upsertFeedDefinition({ name: "HN", url: "https://hn.com/rss" });

      const first = db.insertArticle({
        feedName: "HN",
        url: "https://example.com/post",
        title: "First",
        discoveredAt: "2025-01-01T00:00:00Z",
      });
      const second = db.insertArticle({
        feedName: "HN",
        url: "https://example.com/post",
        title: "Duplicate",
        discoveredAt: "2025-01-02T00:00:00Z",
      });

      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
      expect(second.id).toBeNull();
      expect(db.listArticles({})).toHaveLength(1);
    });

    test("filter by unread", () => {
      using db = createTestDb();
      db.upsertFeedDefinition({ name: "HN", url: "https://hn.com/rss" });

      const r1 = db.insertArticle({
        feedName: "HN",
        url: "https://example.com/1",
        title: "One",
        discoveredAt: "2025-01-01T00:00:00Z",
      });
      db.insertArticle({
        feedName: "HN",
        url: "https://example.com/2",
        title: "Two",
        discoveredAt: "2025-01-02T00:00:00Z",
      });

      db.markArticleRead(r1.id!);

      const unread = db.listArticles({ unread: true });
      expect(unread).toHaveLength(1);
      expect(unread[0].title).toBe("Two");
    });

    test("filter by feed name", () => {
      using db = createTestDb();
      db.upsertFeedDefinition({ name: "HN", url: "https://hn.com/rss" });
      db.upsertFeedDefinition({
        name: "Lobsters",
        url: "https://lobste.rs/rss",
      });

      db.insertArticle({
        feedName: "HN",
        url: "https://example.com/1",
        title: "HN Post",
        discoveredAt: "2025-01-01T00:00:00Z",
      });
      db.insertArticle({
        feedName: "Lobsters",
        url: "https://example.com/2",
        title: "Lobsters Post",
        discoveredAt: "2025-01-01T00:00:00Z",
      });

      const hn = db.listArticles({ feed: "HN" });
      expect(hn).toHaveLength(1);
      expect(hn[0].title).toBe("HN Post");
    });

    test("filter by since", () => {
      using db = createTestDb();
      db.upsertFeedDefinition({ name: "HN", url: "https://hn.com/rss" });

      db.insertArticle({
        feedName: "HN",
        url: "https://example.com/old",
        title: "Old",
        publishedAt: "2025-01-01T00:00:00Z",
        discoveredAt: "2025-01-01T00:00:00Z",
      });
      db.insertArticle({
        feedName: "HN",
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
      db.upsertFeedDefinition({ name: "HN", url: "https://hn.com/rss" });

      for (let i = 0; i < 5; i++) {
        db.insertArticle({
          feedName: "HN",
          url: `https://example.com/${i}`,
          title: `Post ${i}`,
          discoveredAt: `2025-01-0${i + 1}T00:00:00Z`,
        });
      }

      expect(db.listArticles({ limit: 3 })).toHaveLength(3);
    });

    test("markAllRead marks all articles", () => {
      using db = createTestDb();
      db.upsertFeedDefinition({ name: "HN", url: "https://hn.com/rss" });

      db.insertArticle({
        feedName: "HN",
        url: "https://example.com/1",
        title: "One",
        discoveredAt: "2025-01-01T00:00:00Z",
      });
      db.insertArticle({
        feedName: "HN",
        url: "https://example.com/2",
        title: "Two",
        discoveredAt: "2025-01-02T00:00:00Z",
      });

      const count = db.markAllRead();
      expect(count).toBe(2);
      expect(db.listArticles({ unread: true })).toHaveLength(0);
    });

    test("markAllRead by feed name", () => {
      using db = createTestDb();
      db.upsertFeedDefinition({ name: "HN", url: "https://hn.com/rss" });
      db.upsertFeedDefinition({
        name: "Lobsters",
        url: "https://lobste.rs/rss",
      });

      db.insertArticle({
        feedName: "HN",
        url: "https://example.com/1",
        title: "HN",
        discoveredAt: "2025-01-01T00:00:00Z",
      });
      db.insertArticle({
        feedName: "Lobsters",
        url: "https://example.com/2",
        title: "Lobsters",
        discoveredAt: "2025-01-01T00:00:00Z",
      });

      db.markAllRead("HN");
      expect(db.listArticles({ unread: true })).toHaveLength(1);
      expect(db.listArticles({ unread: true })[0].feedName).toBe("Lobsters");
    });
  });
});
