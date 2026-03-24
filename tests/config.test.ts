import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  loadConfig,
  saveConfig,
  normalizeFeedDefinition,
  addFeedToConfig,
  removeFeedFromConfig,
} from "../src/config";

describe("config", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "feeds-cli-test-"));
    configPath = join(tmpDir, "feeds.json5");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("loadConfig", () => {
    test("returns empty feeds when file does not exist", async () => {
      const config = await loadConfig(configPath);
      expect(config).toEqual({ feeds: [] });
    });

    test("parses JSON5 config file", async () => {
      await Bun.write(
        configPath,
        `{
  // This is a comment
  feeds: [
    { name: "HN", url: "https://news.ycombinator.com/rss", },
  ],
}`,
      );
      const config = await loadConfig(configPath);
      expect(config.feeds).toHaveLength(1);
      expect(config.feeds[0].name).toBe("HN");
      expect(config.feeds[0].url).toBe("https://news.ycombinator.com/rss");
    });

    test("normalizes feed definitions on load", async () => {
      await Bun.write(
        configPath,
        `{ feeds: [{ name: " HN ", url: " https://example.com/rss " }] }`,
      );
      const config = await loadConfig(configPath);
      expect(config.feeds[0].name).toBe("HN");
      expect(config.feeds[0].url).toBe("https://example.com/rss");
    });
  });

  describe("saveConfig", () => {
    test("writes JSON5 and reads back", async () => {
      const config = {
        feeds: [{ name: "Test", url: "https://example.com/rss", tags: ["tech"] }],
      };
      await saveConfig(configPath, config);
      const loaded = await loadConfig(configPath);
      expect(loaded.feeds).toHaveLength(1);
      expect(loaded.feeds[0]).toEqual({
        name: "Test",
        url: "https://example.com/rss",
        tags: ["tech"],
      });
    });

    test("creates parent directories if needed", async () => {
      const nestedPath = join(tmpDir, "sub", "dir", "feeds.json5");
      await saveConfig(nestedPath, { feeds: [] });
      const loaded = await loadConfig(nestedPath);
      expect(loaded).toEqual({ feeds: [] });
    });
  });

  describe("normalizeFeedDefinition", () => {
    test("trims whitespace from all fields", () => {
      const result = normalizeFeedDefinition({
        name: " Test ",
        url: " https://example.com ",
        tags: [" a ", " ", " b "],
        scrape: {
          selector: " .article ",
          titleSelector: " h2 ",
          dateSelector: "",
        },
      });
      expect(result.name).toBe("Test");
      expect(result.url).toBe("https://example.com");
      expect(result.tags).toEqual(["a", "b"]);
      expect(result.scrape?.selector).toBe(".article");
      expect(result.scrape?.titleSelector).toBe("h2");
      expect(result.scrape?.dateSelector).toBeUndefined();
    });

    test("defaults tags to empty array", () => {
      const result = normalizeFeedDefinition({
        name: "Test",
        url: "https://example.com",
      });
      expect(result.tags).toEqual([]);
      expect(result.scrape).toBeUndefined();
    });
  });

  describe("addFeedToConfig", () => {
    test("adds a new feed", async () => {
      await addFeedToConfig(configPath, {
        name: "HN",
        url: "https://news.ycombinator.com/rss",
      });
      const config = await loadConfig(configPath);
      expect(config.feeds).toHaveLength(1);
      expect(config.feeds[0].name).toBe("HN");
    });

    test("throws if feed name already exists", async () => {
      await addFeedToConfig(configPath, {
        name: "HN",
        url: "https://news.ycombinator.com/rss",
      });
      expect(
        addFeedToConfig(configPath, {
          name: "HN",
          url: "https://other.com/rss",
        }),
      ).rejects.toThrow('feed "HN" already exists');
    });
  });

  describe("removeFeedFromConfig", () => {
    test("removes an existing feed", async () => {
      await addFeedToConfig(configPath, {
        name: "HN",
        url: "https://news.ycombinator.com/rss",
      });
      await addFeedToConfig(configPath, {
        name: "Lobsters",
        url: "https://lobste.rs/rss",
      });
      await removeFeedFromConfig(configPath, "HN");
      const config = await loadConfig(configPath);
      expect(config.feeds).toHaveLength(1);
      expect(config.feeds[0].name).toBe("Lobsters");
    });

    test("throws if feed name not found", async () => {
      expect(removeFeedFromConfig(configPath, "nope")).rejects.toThrow(
        'feed "nope" not found',
      );
    });
  });
});
