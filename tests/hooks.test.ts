import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverHooks, runHooks } from "../src/cron/hooks";

describe("hooks", () => {
  let hooksDir: string;

  beforeEach(async () => {
    hooksDir = await mkdtemp(join(tmpdir(), "feeds-hooks-"));
  });

  afterEach(async () => {
    await rm(hooksDir, { recursive: true });
  });

  describe("discoverHooks", () => {
    test("returns empty array when directory does not exist", async () => {
      const result = await discoverHooks("/nonexistent", "scan-complete");
      expect(result).toEqual([]);
    });

    test("returns empty array when no matching hooks", async () => {
      await writeFile(join(hooksDir, "unrelated.sh"), "#!/bin/sh\n", {
        mode: 0o755,
      });
      const result = await discoverHooks(hooksDir, "scan-complete");
      expect(result).toEqual([]);
    });

    test("finds matching executable hooks", async () => {
      const hook = join(hooksDir, "on-scan-complete.sh");
      await writeFile(hook, "#!/bin/sh\necho ok\n", { mode: 0o755 });
      const result = await discoverHooks(hooksDir, "scan-complete");
      expect(result).toEqual([hook]);
    });

    test("skips non-executable hooks", async () => {
      const hook = join(hooksDir, "on-scan-complete.sh");
      await writeFile(hook, "#!/bin/sh\necho ok\n", { mode: 0o644 });
      const result = await discoverHooks(hooksDir, "scan-complete");
      expect(result).toEqual([]);
    });

    test("returns multiple hooks sorted by name", async () => {
      const hookB = join(hooksDir, "on-new-articles.py");
      const hookA = join(hooksDir, "on-new-articles.sh");
      await writeFile(hookB, "#!/usr/bin/env python3\n", { mode: 0o755 });
      await writeFile(hookA, "#!/bin/sh\n", { mode: 0o755 });
      const result = await discoverHooks(hooksDir, "new-articles");
      // .py comes before .sh alphabetically
      expect(result).toEqual([hookB, hookA]);
    });
  });

  describe("runHooks", () => {
    test("executes hook with environment variables", async () => {
      const outFile = join(hooksDir, "output.txt");
      const hook = join(hooksDir, "on-scan-complete.sh");
      await writeFile(
        hook,
        `#!/bin/sh\necho "$FEEDS_FEED_NAME" > "${outFile}"\n`,
        { mode: 0o755 },
      );

      await runHooks(hooksDir, {
        event: "scan-complete",
        env: { FEEDS_FEED_NAME: "test-feed" },
      });

      const content = await Bun.file(outFile).text();
      expect(content.trim()).toBe("test-feed");
    });

    test("passes stdin data to hook", async () => {
      const outFile = join(hooksDir, "output.txt");
      const hook = join(hooksDir, "on-new-articles.sh");
      await writeFile(hook, `#!/bin/sh\ncat > "${outFile}"\n`, {
        mode: 0o755,
      });

      const json = JSON.stringify([{ title: "Hello" }]);
      await runHooks(hooksDir, {
        event: "new-articles",
        env: {},
        stdin: json,
      });

      const content = await Bun.file(outFile).text();
      expect(content).toBe(json);
    });

    test("does not throw on non-zero exit", async () => {
      const hook = join(hooksDir, "on-scan-error.sh");
      await writeFile(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });

      // Should not throw
      await runHooks(hooksDir, {
        event: "scan-error",
        env: {},
      });
    });

    test("does nothing when no hooks exist", async () => {
      // Should not throw
      await runHooks(hooksDir, {
        event: "nonexistent",
        env: {},
      });
    });
  });
});
