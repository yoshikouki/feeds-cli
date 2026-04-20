import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  clearCronRuntime,
  loadCronRuntimeState,
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

  test("reports missing runtime state instead of falling back", async () => {
    const root = await mkdtemp(join(tmpdir(), "feeds-cron-runtime-"));
    tempRoots.push(root);
    const statePath = join(root, "missing.json");

    expect(await loadCronRuntimeState(statePath)).toEqual({
      status: "missing",
      runtime: null,
    });
    await expect(resolveCronPaths(statePath)).rejects.toThrow(
      "Cron runtime state is missing",
    );
  });

  test("reports invalid runtime state instead of falling back", async () => {
    const root = await mkdtemp(join(tmpdir(), "feeds-cron-runtime-"));
    tempRoots.push(root);
    const statePath = join(root, "invalid.json");

    await Bun.write(statePath, JSON.stringify({ baseDir: "/tmp/feeds-alt" }));

    expect(await loadCronRuntimeState(statePath)).toEqual({
      status: "invalid",
      runtime: null,
    });
    await expect(resolveCronPaths(statePath)).rejects.toThrow(
      "Cron runtime state is invalid",
    );
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
