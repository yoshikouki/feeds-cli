import { describe, expect, test } from "bun:test";
import {
  cronJobTitle,
  extractCronJobTitleFromArgv,
  normalizeCronBaseDir,
} from "../src/cron/job-id";

describe("cron job title", () => {
  test("is stable for the same normalized workspace path", () => {
    const direct = cronJobTitle("/tmp/feeds/workspace");
    const normalized = cronJobTitle("/tmp/feeds/./nested/../workspace");

    expect(direct).toBe(normalized);
  });

  test("changes across distinct workspaces", () => {
    expect(cronJobTitle("/tmp/feeds/a")).not.toBe(cronJobTitle("/tmp/feeds/b"));
  });

  test("uses a safe, readable title format", () => {
    const title = cronJobTitle("/tmp/feeds/Workspace with 日本語");

    expect(title).toMatch(/^feeds-cli-[a-z0-9-]+-[0-9a-f]{12}$/);
  });
});

describe("extractCronJobTitleFromArgv", () => {
  test("parses inline cron title arguments", () => {
    expect(
      extractCronJobTitleFromArgv([
        "bun",
        "run",
        "--cron-title=feeds-cli-example-abc123def456",
      ]),
    ).toBe("feeds-cli-example-abc123def456");
  });

  test("parses split cron title arguments", () => {
    expect(
      extractCronJobTitleFromArgv([
        "bun",
        "run",
        "--cron-title",
        "feeds-cli-example-abc123def456",
      ]),
    ).toBe("feeds-cli-example-abc123def456");
  });

  test("returns null when the cron title is absent", () => {
    expect(extractCronJobTitleFromArgv(["bun", "run", "src/cron/worker.ts"])).toBeNull();
  });
});

describe("normalizeCronBaseDir", () => {
  test("normalizes dot segments without requiring the path to exist", () => {
    expect(normalizeCronBaseDir("/tmp/feeds/./nested/../workspace")).toBe(
      "/tmp/feeds/workspace",
    );
  });
});
