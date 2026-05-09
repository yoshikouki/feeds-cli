import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs, type ParsedArgs } from "../src/cli/args";
import { addCommand, cronRestorePlan } from "../src/cli/commands/add";
import type { CronStatus } from "../src/cron";
import { runtimeWithDefaultScanJob } from "../src/cron/runtime";
import { fetchFeed } from "../src/parser";
import { scanFeed } from "../src/scanner";
import { FeedDatabase } from "../src/db";
import { resolvePaths } from "../src/paths";
import { loadConfig } from "../src/config";

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <link>https://example.com</link>
    <description>Test</description>
    <item>
      <title>Existing Post</title>
      <link>https://example.com/posts/existing</link>
      <guid>https://example.com/posts/existing</guid>
      <pubDate>Wed, 01 Jan 2025 00:00:00 GMT</pubDate>
      <description>Already published before registration</description>
    </item>
  </channel>
</rss>`;

const SITEMAP_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/posts/hello</loc>
    <lastmod>2025-01-01</lastmod>
  </url>
</urlset>`;

const originalFetch = globalThis.fetch;

describe("add command safe seeding", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root) {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  test("seeds existing articles by default", async () => {
    const root = await tempRoot(tempRoots);
    mockFeedFetch();

    await addCommand(addArgs(root), deps({ registered: false }));

    using db = new FeedDatabase(join(root, "feeds.db"));
    const articles = db.listArticles({});
    expect(articles).toHaveLength(1);
    expect(articles[0]?.title).toBe("Existing Post");
  });

  test("--no-seed skips collecting existing articles", async () => {
    const root = await tempRoot(tempRoots);
    mockFeedFetch();

    await addCommand(addArgs(root, "--no-seed"), deps({ registered: false }));

    using db = new FeedDatabase(join(root, "feeds.db"));
    expect(db.listArticles({})).toHaveLength(0);
  });

  test("default seed does not create events or hook dispatch records", async () => {
    const root = await tempRoot(tempRoots);
    mockFeedFetch();

    await addCommand(addArgs(root), deps({ registered: false }));

    using db = new FeedDatabase(join(root, "feeds.db"));
    const events = db.sqlite
      .query("SELECT COUNT(*) as count FROM events")
      .get() as { count: number | bigint };
    const hookRuns = db.sqlite
      .query("SELECT COUNT(*) as count FROM hook_runs")
      .get() as { count: number | bigint };

    expect(Number(events.count)).toBe(0);
    expect(Number(hookRuns.count)).toBe(0);
  });

  test("stores repeatable sitemap filters on sitemap sources", async () => {
    const root = await tempRoot(tempRoots);
    globalThis.fetch = async () => new Response(SITEMAP_FIXTURE, { status: 200 });

    await addCommand(
      addArgs(
        root,
        "--no-seed",
        "--sitemap-include",
        "/posts/",
        "--sitemap-include",
        "/docs/",
        "--sitemap-exclude",
        "/drafts/",
      ),
      deps({ registered: false }),
    );

    const config = await loadConfig(join(root, "feeds.json5"));
    expect(config.feeds[0]?.sources[0]?.sitemap).toEqual({
      include: ["/posts/", "/docs/"],
      exclude: ["/drafts/"],
    });
  });

  test("stops registered cron and restores the single interval scan job", async () => {
    const root = await tempRoot(tempRoots);
    mockFeedFetch();
    const calls: string[] = [];
    const status = cronStatusFor(root, { registered: true, every: "5m" });

    await addCommand(addArgs(root), deps({
      status,
      cronStop: async () => {
        calls.push("stop");
      },
      cronStart: async (every) => {
        calls.push(`start:${every}`);
      },
    }));

    expect(calls).toEqual(["stop", "start:5m"]);
  });

  test("stops registered cron but refuses unsafe restore", async () => {
    const root = await tempRoot(tempRoots);
    mockFeedFetch();
    const calls: string[] = [];

    await addCommand(addArgs(root), deps({
      status: cronStatusFor(root, { registered: true, runtimeState: "invalid" }),
      cronStop: async () => {
        calls.push("stop");
      },
      cronStart: async () => {
        calls.push("start");
      },
    }));

    expect(calls).toEqual(["stop"]);
  });
});

describe("cron restore plan", () => {
  test("recovers one enabled interval scan job", () => {
    const root = "/tmp/feeds-add-restore";
    const plan = cronRestorePlan(cronStatusFor(root, { registered: true, every: "15m" }));

    expect(plan).toMatchObject({
      registered: true,
      restore: { safe: true, every: "15m" },
    });
  });

  test("refuses registered cron with invalid runtime state", () => {
    const plan = cronRestorePlan(
      cronStatusFor("/tmp/feeds-add-unsafe", {
        registered: true,
        runtimeState: "invalid",
      }),
    );

    expect(plan).toMatchObject({
      registered: true,
      restore: { safe: false, reason: "cron runtime state is invalid" },
    });
  });
});

function addArgs(root: string, ...extra: string[]): ParsedArgs {
  return parseArgs([
    "bun",
    "src/cli.ts",
    "add",
    "https://example.com/feed.xml",
    "--name",
    "example",
    "--base-dir",
    root,
    ...extra,
  ]);
}

async function tempRoot(tempRoots: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "feeds-add-"));
  tempRoots.push(root);
  return root;
}

function mockFeedFetch(): void {
  globalThis.fetch = async () => new Response(RSS_FIXTURE, { status: 200 });
}

function deps(options: {
  registered?: boolean;
  status?: CronStatus;
  cronStop?: (baseDir: string) => Promise<void>;
  cronStart?: (every: string, paths: ReturnType<typeof resolvePaths>) => Promise<void>;
}) {
  return {
    cronStatus: async (baseDir: string) =>
      options.status ?? cronStatusFor(baseDir, { registered: options.registered ?? false }),
    cronStop: options.cronStop ?? (async () => {
      throw new Error("cronStop should not be called");
    }),
    cronStart: options.cronStart ?? (async () => {
      throw new Error("cronStart should not be called");
    }),
    fetchFeed,
    scanFeed,
  };
}

function cronStatusFor(
  root: string,
  options: {
    registered: boolean;
    every?: string;
    runtimeState?: CronStatus["runtimeState"];
  },
): CronStatus {
  const paths = resolvePaths({ baseDir: root });
  const runtime = options.registered && (options.runtimeState ?? "ok") === "ok"
    ? runtimeWithDefaultScanJob(paths, options.every ?? "30m")
    : null;

  return {
    jobTitle: "feeds-cli-feeds-test",
    registered: options.registered,
    heartbeatSchedule: options.registered ? "* * * * *" : null,
    nextHeartbeatRun: null,
    runtimeState: options.registered ? (options.runtimeState ?? "ok") : null,
    runtime,
    execution: [],
    failedEvents: 0,
    pendingEvents: 0,
    failedHookRuns: 0,
    check: {
      ok: true,
      exitCode: 0,
      runtimeState: options.registered ? (options.runtimeState ?? "ok") : "not-registered",
      health: "healthy",
      lastSuccessAt: null,
      pendingEvents: 0,
      failedEvents: 0,
      failedHookRuns: 0,
      issues: [],
    },
  };
}
