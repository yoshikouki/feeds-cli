import { describe, expect, test } from "bun:test";

import { FeedDatabase } from "../src/db";

describe("FeedDatabase", () => {
  test("記事の保存と既読更新ができる", () => {
    const db = new FeedDatabase(":memory:");
    db.upsertFeedDefinition({ name: "HN", url: "https://news.ycombinator.com/rss", tags: ["tech"] });
    db.insertArticle({
      feedName: "HN",
      url: "https://example.com/article",
      title: "Example",
      publishedAt: "2026-03-24T10:00:00.000Z",
      discoveredAt: "2026-03-24T10:00:00.000Z",
      tags: ["tech"],
    });

    const unread = db.listArticles({ unread: true });
    expect(unread).toHaveLength(1);
    expect(unread[0]?.read).toBeFalse();

    const updated = db.markArticleRead(unread[0]!.id);
    expect(updated).toBeTrue();
    expect(db.listArticles({ unread: true })).toHaveLength(0);
    db.close();
  });
});
