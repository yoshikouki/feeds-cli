import type { ArticleRecord, CliStreams, FeedDefinition, FeedStateRecord, OutputFormat, ScanSummary } from "../types";

export function printJson(streams: CliStreams, value: unknown): void {
  streams.stdout(JSON.stringify(value, null, 2));
}

export function printFeedsHuman(
  streams: CliStreams,
  feeds: Array<FeedDefinition & Partial<FeedStateRecord>>,
): void {
  if (feeds.length === 0) {
    streams.stdout("No feeds configured.");
    return;
  }

  for (const feed of feeds) {
    streams.stdout(
      `${feed.name}\t${feed.status ?? "unknown"}\t${feed.tags?.join(",") || "-"}\t${feed.url}`,
    );
  }
}

export function printArticlesHuman(streams: CliStreams, articles: ArticleRecord[]): void {
  if (articles.length === 0) {
    streams.stdout("No articles found.");
    return;
  }

  for (const article of articles) {
    const marker = article.read ? " " : "*";
    streams.stdout(
      `${marker} ${article.id}\t${article.feedName}\t${article.publishedAt ?? article.discoveredAt}\t${article.title}`,
    );
  }
}

export function printScanSummary(streams: CliStreams, summary: ScanSummary, format: OutputFormat): void {
  if (format === "json") {
    printJson(streams, summary);
    return;
  }

  for (const result of summary.feeds) {
    if (result.status === "ok") {
      streams.stdout(`${result.feed}: fetched=${result.fetched} inserted=${result.inserted}`);
    } else {
      streams.stderr(`${result.feed}: error=${result.error ?? "unknown error"}`);
    }
  }
  streams.stdout(
    `totals: fetched=${summary.totals.fetched} inserted=${summary.totals.inserted} errors=${summary.totals.errors}`,
  );
}

export function parseTags(input: string | undefined): string[] {
  if (!input) {
    return [];
  }
  return input
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function requireArg(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`missing required argument: ${name}`);
  }
  return value;
}

export function parseDurationToIso(duration: string, now: Date): string {
  const match = duration.match(/^(\d+)([smhdw])$/);
  if (!match) {
    throw new Error(`invalid duration: ${duration}`);
  }
  const amount = Number(match[1]);
  const unit = match[2] as "s" | "m" | "h" | "d" | "w";
  const multipliers: Record<"s" | "m" | "h" | "d" | "w", number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return new Date(now.getTime() - amount * multipliers[unit]).toISOString();
}
