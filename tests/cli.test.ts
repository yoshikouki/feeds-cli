import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runCli } from "../src/index";
import type { FetchLike } from "../src/types";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CLI integration", () => {
  test("v0.1 の主要コマンドが動作する", async () => {
    const root = await mkdtemp(join(tmpdir(), "feeds-cli-"));
    createdDirs.push(root);

    const configPath = join(root, "feeds.json5");
    const dbPath = join(root, "feeds.db");
    const rss = await Bun.file("tests/fixtures/rss.xml").text();
    const stderr: string[] = [];

    const fetchImpl: FetchLike = async () =>
      new Response(rss, {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      });

    expect(
      await runCli(["add", "HN", "https://news.ycombinator.com/rss", "--config", configPath, "--db", dbPath], {
        stdout: () => {},
        stderr: (line) => stderr.push(line),
        fetchImpl,
        now: () => new Date("2026-03-24T12:00:00.000Z"),
      }),
    ).toBe(0);

    const scanOut: string[] = [];
    expect(
      await runCli(["scan", "--format", "json", "--config", configPath, "--db", dbPath], {
        stdout: (line) => scanOut.push(line),
        stderr: (line) => stderr.push(line),
        fetchImpl,
        now: () => new Date("2026-03-24T12:00:00.000Z"),
      }),
    ).toBe(0);

    const scanSummary = JSON.parse(scanOut.join("\n")) as { totals: { inserted: number } };
    expect(scanSummary.totals.inserted).toBe(2);

    const unreadOut: string[] = [];
    expect(
      await runCli(["list", "--unread", "--format", "json", "--config", configPath, "--db", dbPath], {
        stdout: (line) => unreadOut.push(line),
        stderr: (line) => stderr.push(line),
        fetchImpl,
        now: () => new Date("2026-03-24T12:00:00.000Z"),
      }),
    ).toBe(0);

    const unread = JSON.parse(unreadOut.join("\n")) as Array<{ id: string; title: string }>;
    expect(unread).toHaveLength(2);
    expect(unread[0]?.title).toBe("RSS Post Two");

    expect(
      await runCli(["read", unread[0]!.id, "--config", configPath, "--db", dbPath], {
        stdout: () => {},
        stderr: (line) => stderr.push(line),
        fetchImpl,
        now: () => new Date("2026-03-24T12:00:00.000Z"),
      }),
    ).toBe(0);

    const afterReadOut: string[] = [];
    expect(
      await runCli(["list", "--unread", "--format", "json", "--config", configPath, "--db", dbPath], {
        stdout: (line) => afterReadOut.push(line),
        stderr: (line) => stderr.push(line),
        fetchImpl,
        now: () => new Date("2026-03-24T12:00:00.000Z"),
      }),
    ).toBe(0);

    const afterRead = JSON.parse(afterReadOut.join("\n")) as Array<{ id: string }>;
    expect(afterRead).toHaveLength(1);

    const feedsOut: string[] = [];
    expect(
      await runCli(["list-feeds", "--format", "json", "--config", configPath, "--db", dbPath], {
        stdout: (line) => feedsOut.push(line),
        stderr: (line) => stderr.push(line),
        fetchImpl,
        now: () => new Date("2026-03-24T12:00:00.000Z"),
      }),
    ).toBe(0);

    const feeds = JSON.parse(feedsOut.join("\n")) as Array<{ name: string; status: string }>;
    expect(feeds).toHaveLength(1);
    expect(feeds[0]?.name).toBe("HN");
    expect(feeds[0]?.status).toBe("active");
    expect(stderr).toHaveLength(0);
  });
});
