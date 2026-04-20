import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  clearCronRuntime,
  cronRuntimeStatePath,
  loadCronRuntimeState,
  loadCronRuntime,
  resolveCronPaths,
  runtimeFromPaths,
  saveCronRuntime,
} from "../src/cron/runtime";
import { cronJobTitle } from "../src/cron/job-id";
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
    const jobTitle = cronJobTitle("/tmp/feeds-alt");
    const runtime = runtimeFromPaths(
      resolvePaths({
        baseDir: "/tmp/feeds-alt",
        config: "/tmp/custom.json5",
        db: "/tmp/custom.db",
        noHooks: true,
      }),
    );

    await saveCronRuntime(runtime, jobTitle, root);

    expect(await loadCronRuntime(jobTitle, root)).toEqual(runtime);
    expect(await resolveCronPaths(jobTitle, root)).toEqual({
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
    const jobTitle = cronJobTitle("/tmp/feeds-missing");

    expect(await loadCronRuntimeState(jobTitle, root)).toEqual({
      status: "missing",
      runtime: null,
    });
    await expect(resolveCronPaths(jobTitle, root)).rejects.toThrow(
      "Cron runtime state is missing",
    );
  });

  test("reports invalid runtime state instead of falling back", async () => {
    const root = await mkdtemp(join(tmpdir(), "feeds-cron-runtime-"));
    tempRoots.push(root);
    const jobTitle = cronJobTitle("/tmp/feeds-invalid");
    const statePath = cronRuntimeStatePath(jobTitle, root);

    await Bun.write(statePath, JSON.stringify({ baseDir: "/tmp/feeds-alt" }));

    expect(await loadCronRuntimeState(jobTitle, root)).toEqual({
      status: "invalid",
      runtime: null,
    });
    await expect(resolveCronPaths(jobTitle, root)).rejects.toThrow(
      "Cron runtime state is invalid",
    );
  });

  test("clears persisted runtime state", async () => {
    const root = await mkdtemp(join(tmpdir(), "feeds-cron-runtime-"));
    tempRoots.push(root);
    const jobTitle = cronJobTitle("/tmp/feeds-clear");

    await saveCronRuntime(runtimeFromPaths(resolvePaths({ noHooks: true })), jobTitle, root);
    await clearCronRuntime(jobTitle, root);

    expect(await loadCronRuntime(jobTitle, root)).toBeNull();
  });

  test("separates runtime state per workspace job title", async () => {
    const root = await mkdtemp(join(tmpdir(), "feeds-cron-runtime-"));
    tempRoots.push(root);
    const firstPaths = resolvePaths({ baseDir: "/tmp/feeds-a" });
    const secondPaths = resolvePaths({ baseDir: "/tmp/feeds-b", noHooks: true });
    const firstJobTitle = cronJobTitle(firstPaths.base);
    const secondJobTitle = cronJobTitle(secondPaths.base);

    await saveCronRuntime(runtimeFromPaths(firstPaths), firstJobTitle, root);
    await saveCronRuntime(runtimeFromPaths(secondPaths), secondJobTitle, root);

    expect(cronRuntimeStatePath(firstJobTitle, root)).not.toBe(
      cronRuntimeStatePath(secondJobTitle, root),
    );
    expect(await loadCronRuntime(firstJobTitle, root)).toEqual(runtimeFromPaths(firstPaths));
    expect(await loadCronRuntime(secondJobTitle, root)).toEqual(runtimeFromPaths(secondPaths));
  });
});
