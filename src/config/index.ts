import { dirname } from "node:path";
import { ensureDir } from "../paths";

import type {
  ConfigFile,
  FeedDefinition,
  FeedSourceDefinition,
} from "../types";
import { createId } from "../types";

export async function loadConfig(configPath: string): Promise<ConfigFile> {
  const file = Bun.file(configPath);
  if (!(await file.exists())) {
    return { feeds: [] };
  }

  const parsed = Bun.JSON5.parse(await file.text()) as Partial<ConfigFile>;
  return {
    feeds: Array.isArray(parsed.feeds)
      ? parsed.feeds.map(normalizeFeedDefinition)
      : [],
  };
}

export async function saveConfig(
  configPath: string,
  config: ConfigFile,
): Promise<void> {
  await ensureDir(dirname(configPath));
  await Bun.write(
    configPath,
    `${Bun.JSON5.stringify(
      { feeds: config.feeds.map(normalizeFeedDefinition) },
      null,
      2,
    )}\n`,
  );
}

export function normalizeFeedDefinition(feed: FeedDefinition): FeedDefinition {
  const normalizedSources = normalizeFeedSources(feed);
  const primarySource = normalizedSources[0] ?? {
    id: createId(),
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

  return {
    id: feed.id?.trim() || createId(),
    name: feed.name.trim(),
    url: primarySource.url,
    tags: primarySource.tags ?? [],
    scrape: primarySource.scrape,
    sources: normalizedSources,
  };
}

function normalizeFeedSources(feed: FeedDefinition): FeedSourceDefinition[] {
  const sources =
    feed.sources && feed.sources.length > 0
      ? feed.sources
      : [
          {
            url: feed.url,
            tags: feed.tags,
            scrape: feed.scrape,
          },
        ];

  return sources.map((source) => ({
    id: source.id?.trim() || createId(),
    kind: source.kind,
    url: source.url.trim(),
    tags: source.tags?.map((tag) => tag.trim()).filter(Boolean) ?? [],
    scrape: source.scrape
      ? {
          selector: source.scrape.selector.trim(),
          titleSelector: source.scrape.titleSelector?.trim() || undefined,
          dateSelector: source.scrape.dateSelector?.trim() || undefined,
        }
      : undefined,
  }));
}

export async function addFeedToConfig(
  configPath: string,
  feed: FeedDefinition,
): Promise<void> {
  const config = await loadConfig(configPath);
  if (config.feeds.some((existing) => existing.name === feed.name)) {
    throw new Error(`feed "${feed.name}" already exists`);
  }
  config.feeds.push(normalizeFeedDefinition(feed));
  await saveConfig(configPath, config);
}

export async function removeFeedFromConfig(
  configPath: string,
  name: string,
): Promise<void> {
  const config = await loadConfig(configPath);
  const nextFeeds = config.feeds.filter((feed) => feed.name !== name);
  if (nextFeeds.length === config.feeds.length) {
    throw new Error(`feed "${name}" not found`);
  }
  await saveConfig(configPath, { feeds: nextFeeds });
}
