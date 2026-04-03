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
      <guid>https://example.com/post-1</guid>
      <pubDate>Wed, 01 Jan 2025 00:00:00 GMT</pubDate>
      <description>Short description</description>
      <content:encoded><![CDATA[<p>Full content here</p>]]></content:encoded>
      <author>alice@example.com</author>
      <category>tech</category>
      <category>news</category>
      <enclosure url="https://example.com/audio.mp3" length="12345" type="audio/mpeg"/>
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
    <author>
      <name>Bob</name>
      <uri>https://bob.example.com</uri>
      <email>bob@example.com</email>
    </author>
    <category term="tech"/>
    <category term="web"/>
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
      id: "json-1",
      url: "https://example.com/json-1",
      title: "JSON Post",
      content_html: "<p>HTML content</p>",
      content_text: "Text content",
      summary: "A summary",
      date_published: "2025-01-01T00:00:00Z",
      date_modified: "2025-01-02T00:00:00Z",
      language: "en",
      authors: [{ name: "Charlie", url: "https://charlie.example.com" }],
      tags: ["tech", "feed"],
      attachments: [
        {
          url: "https://example.com/file.pdf",
          mime_type: "application/pdf",
          title: "Doc",
          size_in_bytes: 99999,
        },
      ],
    },
    {
      id: "json-2",
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
    test("normalizes RSS items with rich metadata", () => {
      const { articles, warnings } = parseFeedContent(RSS_FIXTURE);
      expect(warnings).toHaveLength(0);
      expect(articles).toHaveLength(2);

      const a = articles[0];
      expect(a.url).toBe("https://example.com/post-1");
      expect(a.title).toBe("Post 1");
      expect(a.externalId).toBe("https://example.com/post-1");
      expect(a.summary).toBe("Short description");
      expect(a.content).toBe("<p>Full content here</p>");
      expect(a.publishedAt).toBe("2025-01-01T00:00:00.000Z");
      expect(a.sourceFormat).toBe("rss");
      expect(a.updatedAt).toBeNull();
    });

    test("extracts authors from RSS", () => {
      const { articles } = parseFeedContent(RSS_FIXTURE);
      expect(articles[0].authors).toHaveLength(1);
      expect(articles[0].authors[0].name).toBe("alice@example.com");
    });

    test("extracts categories from RSS", () => {
      const { articles } = parseFeedContent(RSS_FIXTURE);
      expect(articles[0].categories).toEqual(["tech", "news"]);
    });

    test("extracts enclosures as attachments", () => {
      const { articles } = parseFeedContent(RSS_FIXTURE);
      expect(articles[0].attachments).toHaveLength(1);
      expect(articles[0].attachments[0]).toEqual({
        url: "https://example.com/audio.mp3",
        mimeType: "audio/mpeg",
        sizeInBytes: 12345,
      });
    });

    test("separates summary (description) from content (content:encoded)", () => {
      const { articles } = parseFeedContent(RSS_FIXTURE);
      expect(articles[0].summary).toBe("Short description");
      expect(articles[0].content).toBe("<p>Full content here</p>");
      // Post 2 has only description → summary, no content
      expect(articles[1].summary).toBe("Only description");
      expect(articles[1].content).toBeNull();
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
      expect(articles[0].externalId).toBe("https://example.com/guid-1");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("Non-permalink GUID");
    });
  });

  describe("Atom 1.0", () => {
    test("normalizes Atom entries with rich metadata", () => {
      const { articles, warnings } = parseFeedContent(ATOM_FIXTURE);
      expect(warnings).toHaveLength(0);
      expect(articles).toHaveLength(1);

      const a = articles[0];
      expect(a.url).toBe("https://example.com/atom-1");
      expect(a.title).toBe("Atom Post");
      expect(a.externalId).toBe("urn:uuid:entry-1");
      expect(a.summary).toBe("Summary text");
      expect(a.content).toBe("<p>Full atom content</p>");
      expect(a.publishedAt).toBe("2025-01-01T12:00:00.000Z");
      expect(a.updatedAt).toBe("2025-01-02T00:00:00.000Z");
      expect(a.sourceFormat).toBe("atom");
    });

    test("extracts authors from Atom", () => {
      const { articles } = parseFeedContent(ATOM_FIXTURE);
      expect(articles[0].authors).toEqual([
        { name: "Bob", url: "https://bob.example.com", email: "bob@example.com" },
      ]);
    });

    test("extracts categories from Atom", () => {
      const { articles } = parseFeedContent(ATOM_FIXTURE);
      expect(articles[0].categories).toEqual(["tech", "web"]);
    });

    test("preserves both summary and content separately", () => {
      const { articles } = parseFeedContent(ATOM_FIXTURE);
      expect(articles[0].summary).toBe("Summary text");
      expect(articles[0].content).toBe("<p>Full atom content</p>");
    });

    test("prefers alternate link over other link types", () => {
      const { articles } = parseFeedContent(ATOM_FIXTURE);
      expect(articles[0].url).toBe("https://example.com/atom-1");
    });

    test("falls back to entry id when no links", () => {
      const { articles } = parseFeedContent(ATOM_ID_FALLBACK_FIXTURE);
      expect(articles).toHaveLength(1);
      expect(articles[0].url).toBe("https://example.com/fallback-id");
      expect(articles[0].externalId).toBe("https://example.com/fallback-id");
    });

    test("uses summary when no content", () => {
      const { articles } = parseFeedContent(ATOM_ID_FALLBACK_FIXTURE);
      expect(articles[0].content).toBeNull();
      expect(articles[0].summary).toBe("Entry with no links");
    });
  });

  describe("JSON Feed 1.1", () => {
    test("normalizes JSON Feed items with rich metadata", () => {
      const { articles, warnings } = parseFeedContent(JSON_FEED_FIXTURE);
      expect(warnings).toHaveLength(0);
      expect(articles).toHaveLength(2);

      const a = articles[0];
      expect(a.url).toBe("https://example.com/json-1");
      expect(a.title).toBe("JSON Post");
      expect(a.externalId).toBe("json-1");
      expect(a.summary).toBe("A summary");
      expect(a.content).toBe("<p>HTML content</p>");
      expect(a.publishedAt).toBe("2025-01-01T00:00:00.000Z");
      expect(a.updatedAt).toBe("2025-01-02T00:00:00.000Z");
      expect(a.language).toBe("en");
      expect(a.sourceFormat).toBe("json");
    });

    test("extracts authors from JSON Feed", () => {
      const { articles } = parseFeedContent(JSON_FEED_FIXTURE);
      expect(articles[0].authors).toEqual([
        { name: "Charlie", url: "https://charlie.example.com" },
      ]);
    });

    test("extracts tags as categories", () => {
      const { articles } = parseFeedContent(JSON_FEED_FIXTURE);
      expect(articles[0].categories).toEqual(["tech", "feed"]);
    });

    test("extracts attachments from JSON Feed", () => {
      const { articles } = parseFeedContent(JSON_FEED_FIXTURE);
      expect(articles[0].attachments).toEqual([
        {
          url: "https://example.com/file.pdf",
          mimeType: "application/pdf",
          title: "Doc",
          sizeInBytes: 99999,
        },
      ]);
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
      expect(articles[0].sourceFormat).toBe("rss");
    });
  });
});
