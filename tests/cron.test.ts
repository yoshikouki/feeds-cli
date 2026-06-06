import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { intervalToCron, maybeRunHooks, prepareCyclePaths, runCycle } from "../src/cron/index";
import { renderCronCheck, renderCronStatus } from "../src/cli/commands/cron";
import { FeedDatabase } from "../src/db";
import { resolvePaths } from "../src/paths";

const BETA_RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>OpenClaw Releases</title>
    <link>https://example.com</link>
    <description>Releases</description>
    <item>
      <title>OpenClaw 2026.5.27 Beta</title>
      <link>https://example.com/releases/beta</link>
      <guid>https://example.com/releases/beta</guid>
      <pubDate>Wed, 27 May 2026 00:00:00 GMT</pubDate>
      <description>Preview release</description>
    </item>
  </channel>
</rss>`;

const originalFetch = globalThis.fetch;

describe("intervalToCron", () => {
  test("converts minutes to cron expression", () => {
    expect(intervalToCron("15m")).toBe("*/15 * * * *");
    expect(intervalToCron("30m")).toBe("*/30 * * * *");
    expect(intervalToCron("5m")).toBe("*/5 * * * *");
  });

  test("converts hours to cron expression", () => {
    expect(intervalToCron("1h")).toBe("0 * * * *");
    expect(intervalToCron("2h")).toBe("0 */2 * * *");
    expect(intervalToCron("6h")).toBe("0 */6 * * *");
  });

  test("rejects invalid format", () => {
    expect(() => intervalToCron("abc")).toThrow("Invalid interval");
    expect(() => intervalToCron("30")).toThrow("Invalid interval");
    expect(() => intervalToCron("30s")).toThrow("Invalid interval");
    expect(() => intervalToCron("30d")).toThrow("Invalid interval");
    expect(() => intervalToCron("")).toThrow("Invalid interval");
  });
});

describe("maybeRunHooks", () => {
  let hooksDir: string;

  beforeEach(async () => {
    hooksDir = await mkdtemp(join(tmpdir(), "feeds-cron-hooks-"));
  });

  afterEach(async () => {
    await rm(hooksDir, { recursive: true, force: true });
  });

  test("runs hooks when enabled", async () => {
    const outFile = join(hooksDir, "output.txt");
    await writeFile(
      join(hooksDir, "on-cycle-complete.sh"),
      `#!/bin/sh\necho "$FEEDS_TOTAL_NEW_ARTICLES" > "${outFile}"\n`,
      { mode: 0o755 },
    );

    await maybeRunHooks(
      { hooksDir, hooksEnabled: true },
      {
        event: "cycle-complete",
        env: { FEEDS_TOTAL_NEW_ARTICLES: "3" },
      },
    );

    expect((await Bun.file(outFile).text()).trim()).toBe("3");
  });

  test("skips hooks when disabled", async () => {
    const outFile = join(hooksDir, "output.txt");
    await writeFile(
      join(hooksDir, "on-cycle-complete.sh"),
      `#!/bin/sh\necho "$FEEDS_TOTAL_NEW_ARTICLES" > "${outFile}"\n`,
      { mode: 0o755 },
    );

    await maybeRunHooks(
      { hooksDir, hooksEnabled: false },
      {
        event: "cycle-complete",
        env: { FEEDS_TOTAL_NEW_ARTICLES: "3" },
      },
    );

    expect(await Bun.file(outFile).exists()).toBe(false);
  });
});

describe("runCycle hook filters", () => {
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

  test("keeps excluded entries in storage while skipping new-articles hooks", async () => {
    const root = await mkdtemp(join(tmpdir(), "feeds-cycle-filter-"));
    tempRoots.push(root);
    const paths = resolvePaths({ baseDir: root });
    const outFile = join(root, "hook-output.json");

    await mkdir(paths.hooksDir, { recursive: true });
    await writeFile(
      join(paths.hooksDir, "on-new-articles.sh"),
      `#!/bin/sh\ncat > "${outFile}"\n`,
      { mode: 0o755 },
    );
    await writeFile(
      paths.config,
      `{
  feeds: [
    {
      id: "openclaw",
      name: "OpenClaw Releases",
      sources: [
        {
          id: "openclaw-releases",
          name: "GitHub Releases",
          url: "https://example.com/releases.atom",
          hooks: {
            exclude: [{ title: "/beta/i" }],
          },
        },
      ],
    },
  ],
}
`,
    );
    globalThis.fetch = async () => new Response(BETA_RSS_FIXTURE, { status: 200 });

    await runCycle(paths, "manual");

    using db = new FeedDatabase(paths.db);
    expect(db.listArticles({})).toHaveLength(1);
    expect(await Bun.file(outFile).exists()).toBe(false);

    const entryEvents = db.sqlite
      .query("SELECT status FROM events WHERE kind = 'entry.discovered'")
      .all() as Array<{ status: string }>;
    expect(entryEvents).toEqual([{ status: "dispatched" }]);

    const hookRunCount = db.sqlite
      .query("SELECT COUNT(*) as count FROM hook_runs")
      .get() as { count: number | bigint };
    expect(Number(hookRunCount.count)).toBe(0);
  });
});

describe("renderCronStatus", () => {
  test("shows effective runtime details", () => {
    const text = renderCronStatus({
      jobTitle: "feeds-cli-feeds-abc123def456",
      registered: true,
      heartbeatSchedule: "* * * * *",
      nextHeartbeatRun: new Date("2026-04-20T01:30:00.000Z"),
      runtimeState: "ok",
      runtime: {
        baseDir: "/tmp/feeds",
        config: "/tmp/feeds/feeds.json5",
        db: "/tmp/feeds/feeds.db",
        hooksDir: "/tmp/feeds/hooks/cron",
        hooksEnabled: false,
        heartbeatSchedule: "* * * * *",
        jobs: [
          {
            id: "job-1",
            workspaceId: "/tmp/feeds",
            pipelineId: "pipeline-1",
            purpose: "scan",
            schedule: { kind: "interval", every: "30m" },
            enabled: true,
          },
        ],
      },
      execution: [],
      failedEvents: 0,
      pendingEvents: 0,
      failedHookRuns: 0,
      check: {
        ok: true,
        exitCode: 0,
        runtimeState: "ok",
        health: "healthy",
        lastSuccessAt: null,
        pendingEvents: 0,
        failedEvents: 0,
        failedHookRuns: 0,
        issues: [],
      },
    });

    expect(text).toContain("job title:     feeds-cli-feeds-abc123def456");
    expect(text).toContain("base dir:      /tmp/feeds");
    expect(text).toContain("config:        /tmp/feeds/feeds.json5");
    expect(text).toContain("db:            /tmp/feeds/feeds.db");
    expect(text).toContain("hooks:         disabled");
    expect(text).toContain("hooks dir:     /tmp/feeds/hooks/cron");
  });

  test("shows broken runtime state explicitly", () => {
    const text = renderCronStatus({
      jobTitle: "feeds-cli-feeds-abc123def456",
      registered: true,
      heartbeatSchedule: "* * * * *",
      nextHeartbeatRun: new Date("2026-04-20T01:30:00.000Z"),
      runtimeState: "invalid",
      runtime: null,
      execution: [],
      failedEvents: 0,
      pendingEvents: 0,
      failedHookRuns: 0,
      check: {
        ok: false,
        exitCode: 1,
        runtimeState: "invalid",
        health: "healthy",
        lastSuccessAt: null,
        pendingEvents: 0,
        failedEvents: 0,
        failedHookRuns: 0,
        issues: [{ code: "runtime-invalid", message: "cron runtime state is invalid", jobId: null }],
      },
    });

    expect(text).toContain("runtime state: invalid");
    expect(text).toContain("runtime:       unavailable");
  });

  test("shows outdated runtime state as repair required", () => {
    const text = renderCronStatus({
      jobTitle: "feeds-cli-feeds-abc123def456",
      registered: true,
      heartbeatSchedule: "* * * * *",
      nextHeartbeatRun: new Date("2026-04-20T01:30:00.000Z"),
      runtimeState: "outdated",
      runtime: null,
      execution: [],
      failedEvents: 0,
      pendingEvents: 0,
      failedHookRuns: 0,
      check: {
        ok: false,
        exitCode: 1,
        runtimeState: "outdated",
        health: "healthy",
        lastSuccessAt: null,
        pendingEvents: 0,
        failedEvents: 0,
        failedHookRuns: 0,
        issues: [{ code: "runtime-outdated", message: "cron runtime state requires repair", jobId: null }],
      },
    });

    expect(text).toContain("runtime state: repair required");
    expect(text).toContain("runtime:       unavailable");
  });


  test("renders cron check success", () => {
    const text = renderCronCheck({
      jobTitle: "feeds-cli-feeds-abc123def456",
      registered: true,
      heartbeatSchedule: "* * * * *",
      nextHeartbeatRun: null,
      runtimeState: "ok",
      runtime: null,
      execution: [],
      failedEvents: 0,
      pendingEvents: 0,
      failedHookRuns: 0,
      check: {
        ok: true,
        exitCode: 0,
        runtimeState: "ok",
        health: "healthy",
        lastSuccessAt: null,
        pendingEvents: 0,
        failedEvents: 0,
        failedHookRuns: 0,
        issues: [],
      },
    });

    expect(text).toBe("cron ok: feeds-cli-feeds-abc123def456");
  });

  test("renders cron check failures", () => {
    const text = renderCronCheck({
      jobTitle: "feeds-cli-feeds-abc123def456",
      registered: true,
      heartbeatSchedule: "* * * * *",
      nextHeartbeatRun: null,
      runtimeState: "outdated",
      runtime: null,
      execution: [],
      failedEvents: 0,
      pendingEvents: 0,
      failedHookRuns: 0,
      check: {
        ok: false,
        exitCode: 1,
        runtimeState: "outdated",
        health: "healthy",
        lastSuccessAt: null,
        pendingEvents: 0,
        failedEvents: 0,
        failedHookRuns: 0,
        issues: [{ code: "runtime-outdated", message: "cron runtime state requires repair", jobId: null }],
      },
    });

    expect(text).toContain("cron check failed: feeds-cli-feeds-abc123def456");
    expect(text).toContain("- runtime-outdated: cron runtime state requires repair");
  });

});

describe("prepareCyclePaths", () => {
  test("creates the base directory before a cycle runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "feeds-cycle-paths-"));
    const base = join(root, "nested", "runtime");

    try {
      await prepareCyclePaths({ base });
      await access(base);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
