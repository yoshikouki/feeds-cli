import { describe, test, expect } from "bun:test";
import { parseFeedContent } from "../src/parser";

// ── Fixtures ──

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Test RSS</title>
    <link>https://example.com</link>
    <description>A test feed</description>
    <item>
      <title>Post 1</title>
      <link>https://example.com/post-1</link>
      <pubDate>Wed, 01 Jan 2025 00:00:00 GMT</pubDate>
      <description>Short description</description>
      <content:encoded><![CDATA[<p>Full content here</p>]]></content:encoded>
    </item>
    <item>
      <title>Post 2</title>
      <link>https://example.com/post-2</link>
      <description>Only description</description>
    </item>
  </channel>
</rss>`;

const RSS_NO_URL_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test</title>
    <link>https://example.com</link>
    <description>Test</description>
    <item>
      <title>Has URL</title>
      <link>https://example.com/ok</link>
    </item>
    <item>
      <title>No URL Item</title>
      <description>This item has no link or guid</description>
    </item>
  </channel>
</rss>`;

const RSS_GUID_PERMALINK_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test</title>
    <link>https://example.com</link>
    <description>Test</description>
    <item>
      <title>GUID as URL</title>
      <guid>https://example.com/guid-1</guid>
    </item>
    <item>
      <title>Non-permalink GUID</title>
      <guid isPermaLink="false">internal-id-123</guid>
    </item>
  </channel>
</rss>`;

const ATOM_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test Atom</title>
  <id>urn:uuid:test-feed</id>
  <updated>2025-01-01T00:00:00Z</updated>
  <entry>
    <title>Atom Post</title>
    <id>urn:uuid:entry-1</id>
    <link href="https://example.com/atom-1" rel="alternate"/>
    <link href="https://example.com/atom-1.json" rel="self" type="application/json"/>
    <published>2025-01-01T12:00:00Z</published>
    <updated>2025-01-02T00:00:00Z</updated>
    <summary>Summary text</summary>
    <content type="html"><![CDATA[<p>Full atom content</p>]]></content>
  </entry>
</feed>`;

const ATOM_ID_FALLBACK_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test</title>
  <id>urn:uuid:test</id>
  <updated>2025-01-01T00:00:00Z</updated>
  <entry>
    <title>No Links</title>
    <id>https://example.com/fallback-id</id>
    <updated>2025-01-01T00:00:00Z</updated>
    <summary>Entry with no links</summary>
  </entry>
</feed>`;

const JSON_FEED_FIXTURE = JSON.stringify({
  version: "https://jsonfeed.org/version/1.1",
  title: "Test JSON Feed",
  items: [
    {
      id: "1",
      url: "https://example.com/json-1",
      title: "JSON Post",
      content_html: "<p>HTML content</p>",
      content_text: "Text content",
      date_published: "2025-01-01T00:00:00Z",
    },
    {
      id: "2",
      external_url: "https://external.com/linked",
      title: "External Link",
      content_text: "Points elsewhere",
    },
  ],
});

const JSON_FEED_NO_URL_FIXTURE = JSON.stringify({
  version: "https://jsonfeed.org/version/1.1",
  title: "Test",
  items: [
    { id: "1", title: "No URL item", content_text: "Missing url field" },
  ],
});

// ── Tests ──

describe("parseFeedContent", () => {
  describe("RSS 2.0", () => {
    test("normalizes RSS items", () => {
      const { articles, warnings } = parseFeedContent(RSS_FIXTURE);
      expect(warnings).toHaveLength(0);
      expect(articles).toHaveLength(2);

      expect(articles[0].url).toBe("https://example.com/post-1");
      expect(articles[0].title).toBe("Post 1");
      expect(articles[0].content).toBe("<p>Full content here</p>");
      expect(articles[0].publishedAt).toBe("Wed, 01 Jan 2025 00:00:00 GMT");

      expect(articles[1].url).toBe("https://example.com/post-2");
      expect(articles[1].content).toBe("Only description");
    });

    test("content:encoded takes priority over description", () => {
      const { articles } = parseFeedContent(RSS_FIXTURE);
      expect(articles[0].content).toBe("<p>Full content here</p>");
    });

    test("skips items without URL and adds warning", () => {
      const { articles, warnings } = parseFeedContent(RSS_NO_URL_FIXTURE);
      expect(articles).toHaveLength(1);
      expect(articles[0].title).toBe("Has URL");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("No URL Item");
    });

    test("uses guid as URL when isPermaLink is not false", () => {
      const { articles, warnings } = parseFeedContent(RSS_GUID_PERMALINK_FIXTURE);
      expect(articles).toHaveLength(1);
      expect(articles[0].url).toBe("https://example.com/guid-1");
      expect(articles[0].title).toBe("GUID as URL");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("Non-permalink GUID");
    });
  });

  describe("Atom 1.0", () => {
    test("normalizes Atom entries", () => {
      const { articles, warnings } = parseFeedContent(ATOM_FIXTURE);
      expect(warnings).toHaveLength(0);
      expect(articles).toHaveLength(1);

      expect(articles[0].url).toBe("https://example.com/atom-1");
      expect(articles[0].title).toBe("Atom Post");
      expect(articles[0].content).toBe("<p>Full atom content</p>");
      expect(articles[0].publishedAt).toBe("2025-01-01T12:00:00Z");
    });

    test("prefers alternate link over other link types", () => {
      const { articles } = parseFeedContent(ATOM_FIXTURE);
      expect(articles[0].url).toBe("https://example.com/atom-1");
    });

    test("falls back to entry id when no links", () => {
      const { articles } = parseFeedContent(ATOM_ID_FALLBACK_FIXTURE);
      expect(articles).toHaveLength(1);
      expect(articles[0].url).toBe("https://example.com/fallback-id");
    });

    test("prefers content over summary", () => {
      const { articles } = parseFeedContent(ATOM_FIXTURE);
      expect(articles[0].content).toBe("<p>Full atom content</p>");
    });

    test("falls back to summary when no content", () => {
      const { articles } = parseFeedContent(ATOM_ID_FALLBACK_FIXTURE);
      expect(articles[0].content).toBe("Entry with no links");
    });
  });

  describe("JSON Feed 1.1", () => {
    test("normalizes JSON Feed items", () => {
      const { articles, warnings } = parseFeedContent(JSON_FEED_FIXTURE);
      expect(warnings).toHaveLength(0);
      expect(articles).toHaveLength(2);

      expect(articles[0].url).toBe("https://example.com/json-1");
      expect(articles[0].title).toBe("JSON Post");
      expect(articles[0].publishedAt).toBe("2025-01-01T00:00:00Z");
    });

    test("prefers content_html over content_text", () => {
      const { articles } = parseFeedContent(JSON_FEED_FIXTURE);
      expect(articles[0].content).toBe("<p>HTML content</p>");
    });

    test("falls back to external_url", () => {
      const { articles } = parseFeedContent(JSON_FEED_FIXTURE);
      expect(articles[1].url).toBe("https://external.com/linked");
    });

    test("skips items without URL and adds warning", () => {
      const { articles, warnings } = parseFeedContent(JSON_FEED_NO_URL_FIXTURE);
      expect(articles).toHaveLength(0);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("No URL item");
    });
  });

  describe("edge cases", () => {
    test("throws on unparseable content", () => {
      expect(() => parseFeedContent("not a feed")).toThrow();
    });

    test("handles empty items list", () => {
      const emptyRss = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Empty</title>
    <link>https://example.com</link>
    <description>No items</description>
  </channel>
</rss>`;
      const { articles, warnings } = parseFeedContent(emptyRss);
      expect(articles).toHaveLength(0);
      expect(warnings).toHaveLength(0);
    });

    test("untitled items get placeholder", () => {
      const rss = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Test</title>
    <link>https://example.com</link>
    <description>Test</description>
    <item>
      <link>https://example.com/no-title</link>
    </item>
  </channel>
</rss>`;
      const { articles } = parseFeedContent(rss);
      expect(articles[0].title).toBe("(untitled)");
    });
  });
});
