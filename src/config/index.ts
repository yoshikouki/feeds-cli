import JSON5 from "json5";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

import type { ConfigFile, FeedDefinition } from "../types";

const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "feeds-cli");

export function getDefaultConfigPath(): string {
  return join(DEFAULT_CONFIG_DIR, "feeds.json5");
}

export function getDefaultDbPath(): string {
  return join(DEFAULT_CONFIG_DIR, "feeds.db");
}

export async function loadConfig(configPath: string): Promise<ConfigFile> {
  const file = Bun.file(configPath);
  if (!(await file.exists())) {
    return { feeds: [] };
  }

  const parsed = JSON5.parse(await file.text()) as Partial<ConfigFile>;
  return {
    feeds: Array.isArray(parsed.feeds) ? parsed.feeds.map(normalizeFeedDefinition) : [],
  };
}

export async function saveConfig(configPath: string, config: ConfigFile): Promise<void> {
  await ensureParentDir(configPath);
  await Bun.write(configPath, `${JSON5.stringify(config, null, 2)}\n`);
}

export async function ensureParentDir(filePath: string): Promise<void> {
  await Bun.$`mkdir -p ${dirname(filePath)}`.quiet();
}

export function normalizeFeedDefinition(feed: FeedDefinition): FeedDefinition {
  return {
    name: feed.name.trim(),
    url: feed.url.trim(),
    tags: feed.tags?.map((tag) => tag.trim()).filter(Boolean) ?? [],
    scrape: feed.scrape
      ? {
          selector: feed.scrape.selector.trim(),
          titleSelector: feed.scrape.titleSelector?.trim() || undefined,
          dateSelector: feed.scrape.dateSelector?.trim() || undefined,
        }
      : undefined,
  };
}

export async function addFeedToConfig(configPath: string, feed: FeedDefinition): Promise<void> {
  const config = await loadConfig(configPath);
  if (config.feeds.some((existing) => existing.name === feed.name)) {
    throw new Error(`feed "${feed.name}" already exists`);
  }

  config.feeds.push(normalizeFeedDefinition(feed));
  await saveConfig(configPath, config);
}

export async function removeFeedFromConfig(configPath: string, name: string): Promise<void> {
  const config = await loadConfig(configPath);
  const nextFeeds = config.feeds.filter((feed) => feed.name !== name);
  if (nextFeeds.length === config.feeds.length) {
    throw new Error(`feed "${name}" not found`);
  }

  await saveConfig(configPath, { feeds: nextFeeds });
}
