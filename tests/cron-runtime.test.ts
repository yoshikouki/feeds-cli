import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  clearCronRuntime,
  CRON_RUNTIME_VERSION,
  cronRuntimeStatePath,
  loadCronRuntimeState,
  loadCronRuntime,
  resolveCronPaths,
  runtimeFromPaths,
  saveCronRuntime,
} from "../src/cron/runtime";
import { cronRepair } from "../src/cron/index";
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
      legacyRuntime: null,
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
      legacyRuntime: null,
    });
    await expect(resolveCronPaths(jobTitle, root)).rejects.toThrow(
      "Cron runtime state is invalid",
    );
  });

  test("reports legacy runtime state as outdated", async () => {
    const root = await mkdtemp(join(tmpdir(), "feeds-cron-runtime-"));
    tempRoots.push(root);
    const jobTitle = cronJobTitle("/tmp/feeds-legacy");
    const statePath = cronRuntimeStatePath(jobTitle, root);
    const legacyRuntime = {
      baseDir: "/tmp/feeds-legacy",
      config: "/tmp/feeds-legacy/feeds.json5",
      db: "/tmp/feeds-legacy/feeds.db",
      hooksDir: "/tmp/feeds-legacy/hooks/cron",
      hooksEnabled: true,
    };

    await Bun.write(statePath, JSON.stringify(legacyRuntime));

    expect(await loadCronRuntime(jobTitle, root)).toBeNull();
    expect(await loadCronRuntimeState(jobTitle, root)).toEqual({
      status: "outdated",
      runtime: null,
      legacyRuntime,
    });
    await expect(resolveCronPaths(jobTitle, root)).rejects.toThrow(
      "Cron runtime state is outdated and requires repair",
    );
  });


  test("repair refuses hooks-enabled legacy runtime without --no-hooks", async () => {
    const root = await mkdtemp(join(tmpdir(), "feeds-cron-runtime-"));
    tempRoots.push(root);
    const baseDir = "/tmp/feeds-repair-refuse";
    const jobTitle = cronJobTitle(baseDir);
    const statePath = cronRuntimeStatePath(jobTitle, root);
    await Bun.write(statePath, JSON.stringify({
      baseDir,
      config: `${baseDir}/feeds.json5`,
      db: `${baseDir}/feeds.db`,
      hooksDir: `${baseDir}/hooks/cron`,
      hooksEnabled: true,
    }));

    await expect(cronRepair(baseDir, "5m", { controlBaseDir: root })).rejects.toThrow(
      "--no-hooks",
    );
  });

  test("repair can rewrite legacy runtime with hooks disabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "feeds-cron-runtime-"));
    tempRoots.push(root);
    const baseDir = "/tmp/feeds-repair";
    const jobTitle = cronJobTitle(baseDir);
    const statePath = cronRuntimeStatePath(jobTitle, root);
    await Bun.write(statePath, JSON.stringify({
      baseDir,
      config: `${baseDir}/feeds.json5`,
      db: `${baseDir}/feeds.db`,
      hooksDir: `${baseDir}/hooks/cron`,
      hooksEnabled: true,
    }));

    const runtime = await cronRepair(baseDir, "5m", { hooksEnabled: false, controlBaseDir: root });

    expect(runtime.version).toBe(CRON_RUNTIME_VERSION);
    expect(runtime.hooksEnabled).toBe(false);
    expect(runtime.jobs[0]?.schedule).toEqual({ kind: "interval", every: "5m" });
    expect((await loadCronRuntimeState(jobTitle, root)).status).toBe("ok");
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

  test("writes current runtime version when saving", async () => {
    const root = await mkdtemp(join(tmpdir(), "feeds-cron-runtime-"));
    tempRoots.push(root);
    const paths = resolvePaths({ baseDir: "/tmp/feeds-versioned", noHooks: true });
    const jobTitle = cronJobTitle(paths.base);

    await saveCronRuntime(runtimeFromPaths(paths), jobTitle, root);

    const saved = JSON.parse(await Bun.file(cronRuntimeStatePath(jobTitle, root)).text());
    expect(saved.version).toBe(CRON_RUNTIME_VERSION);
  });
});
