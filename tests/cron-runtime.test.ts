import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  clearCronRuntime,
  loadCronRuntime,
  resolveCronPaths,
  runtimeFromPaths,
  saveCronRuntime,
} from "../src/cron/runtime";
import { resolvePaths } from "../src/paths";

describe("cron runtime state", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    while (tempRoots.length > 0) {
      const dir = tempRoots.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  test("persists resolved runtime for future cron runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "feeds-cron-runtime-"));
    tempRoots.push(root);
    const statePath = join(root, "cron.runtime.json");
    const runtime = runtimeFromPaths(
      resolvePaths({
        baseDir: "/tmp/feeds-alt",
        config: "/tmp/custom.json5",
        db: "/tmp/custom.db",
        noHooks: true,
      }),
    );

    await saveCronRuntime(runtime, statePath);

    expect(await loadCronRuntime(statePath)).toEqual(runtime);
    expect(await resolveCronPaths(statePath)).toEqual({
      base: "/tmp/feeds-alt",
      config: "/tmp/custom.json5",
      db: "/tmp/custom.db",
      hooksDir: "/tmp/feeds-alt/hooks/cron",
      hooksEnabled: false,
    });
  });

  test("falls back to default runtime when no state exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "feeds-cron-runtime-"));
    tempRoots.push(root);
    const statePath = join(root, "missing.json");

    expect(await resolveCronPaths(statePath)).toEqual(resolvePaths());
  });

  test("clears persisted runtime state", async () => {
    const root = await mkdtemp(join(tmpdir(), "feeds-cron-runtime-"));
    tempRoots.push(root);
    const statePath = join(root, "cron.runtime.json");

    await saveCronRuntime(runtimeFromPaths(resolvePaths({ noHooks: true })), statePath);
    await clearCronRuntime(statePath);

    expect(await loadCronRuntime(statePath)).toBeNull();
  });
});
