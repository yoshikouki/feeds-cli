import { describe, expect, test } from "bun:test";

import { parseFeedXml } from "../src/feed/parser";

describe("parseFeedXml", () => {
  test("RSS 2.0 をパースできる", async () => {
    const xml = await Bun.file("tests/fixtures/rss.xml").text();
    const entries = parseFeedXml(xml);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.title).toBe("RSS Post One");
    expect(entries[1]?.url).toBe("https://example.com/posts/2");
  });

  test("Atom 1.0 をパースできる", async () => {
    const xml = await Bun.file("tests/fixtures/atom.xml").text();
    const entries = parseFeedXml(xml);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe("Atom Entry");
    expect(entries[0]?.url).toBe("https://example.com/atom/1");
  });
});
