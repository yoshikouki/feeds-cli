import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { intervalToCron, maybeRunHooks } from "../src/cron/index";

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
