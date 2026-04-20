import { join, dirname } from "node:path";
import { outputInfo, outputWarn, outputError } from "../cli/output.ts";
import { loadConfig } from "../config/index.ts";
import { FeedDatabase } from "../db/index.ts";
import { scanFeed, type ScanResult } from "../scanner.ts";
import { ensureDir, type ResolvedPaths } from "../paths.ts";
import { runHooks } from "./hooks.ts";
import type { CycleTrigger } from "../types.ts";
import {
  clearCronRuntime,
  loadCronRuntimeState,
  loadCronRuntime,
  runtimeFromPaths,
  type CronRuntime,
  type CronRuntimeState,
  saveCronRuntime,
} from "./runtime.ts";
import { cronJobTitle } from "./job-id.ts";

const WORKER_PATH = join(dirname(import.meta.filename), "worker.ts");

/**
 * Convert an interval string like "30m", "1h" to a cron expression.
 */
export function intervalToCron(input: string): string {
  const match = input.match(/^(\d+)(m|h)$/);
  if (!match) throw new Error(`Invalid interval: ${input} (use e.g. 30m, 1h)`);
  const value = Number(match[1]);
  const unit = match[2];
  switch (unit) {
    case "m":
      if (value > 0 && 60 % value === 0) return `*/${value} * * * *`;
      return `*/${value} * * * *`;
    case "h":
      if (value === 1) return `0 * * * *`;
      return `0 */${value} * * *`;
    default:
      throw new Error(`Invalid interval unit: ${unit}`);
  }
}

/**
 * Run a single scan cycle over all feeds, firing hooks at each stage.
 * Records execution in cycle_log (write-at-start, update-at-end).
 */
export async function runCycle(
  paths: ResolvedPaths,
  trigger: CycleTrigger = "manual",
): Promise<void> {
  const cycleStart = performance.now();
  const config = await loadConfig(paths.config);

  if (config.feeds.length === 0) {
    outputWarn("No feeds in config, skipping cycle.");
    return;
  }

  using db = new FeedDatabase(paths.db);
  const cycleId = db.insertCycleLog(trigger);
  let totalNew = 0;
  let hasErrors = false;

  try {
    for (const feedDef of config.feeds) {
      const feedEnv = {
        FEEDS_FEED_NAME: feedDef.name,
        FEEDS_FEED_ID: feedDef.id ?? "",
      };

      await maybeRunHooks(paths, {
        event: "scan-start",
        env: feedEnv,
      });

      let result: ScanResult;
      try {
        result = await scanFeed(db, feedDef, cycleId);
      } catch (err) {
        hasErrors = true;
        const message = err instanceof Error ? err.message : String(err);
        outputError(`Scan failed for ${feedDef.name}: ${message}`);
        await maybeRunHooks(paths, {
          event: "scan-error",
          env: { ...feedEnv, FEEDS_ERROR_MESSAGE: message },
        });
        continue;
      }

      await maybeRunHooks(paths, {
        event: "scan-complete",
        env: {
          ...feedEnv,
          FEEDS_ARTICLE_COUNT: String(result.articlesFound),
          FEEDS_NEW_ARTICLE_COUNT: String(result.articlesInserted),
        },
      });

      if (result.newArticles.length > 0) {
        const json = JSON.stringify(result.newArticles);
        await maybeRunHooks(paths, {
          event: "new-articles",
          env: {
            ...feedEnv,
            FEEDS_NEW_ARTICLES_JSON: json,
          },
          stdin: json,
        });
      }

      totalNew += result.articlesInserted;
      if (result.errors.length > 0) hasErrors = true;

      for (const err of result.errors) {
        outputWarn(err);
      }

      outputInfo(
        `${result.feedName}: ${result.articlesInserted} new / ${result.articlesFound} found`,
      );
    }

    const durationMs = Math.round(performance.now() - cycleStart);
    db.finishCycleLog(
      cycleId,
      hasErrors ? "error" : "success",
      durationMs,
    );

    await maybeRunHooks(paths, {
      event: "cycle-complete",
      env: {
        FEEDS_TOTAL_FEEDS: String(config.feeds.length),
        FEEDS_TOTAL_NEW_ARTICLES: String(totalNew),
        FEEDS_CYCLE_DURATION_MS: String(durationMs),
      },
    });

    db.pruneLogs();

    outputInfo(`Cycle complete: ${totalNew} new articles in ${durationMs}ms`);
  } catch (err) {
    const durationMs = Math.round(performance.now() - cycleStart);
    const message = err instanceof Error ? err.message : String(err);
    db.finishCycleLog(cycleId, "error", durationMs, message);
    throw err;
  }
}

export async function maybeRunHooks(
  paths: Pick<ResolvedPaths, "hooksDir" | "hooksEnabled">,
  params: Parameters<typeof runHooks>[1],
): Promise<void> {
  if (!paths.hooksEnabled) {
    return;
  }

  await runHooks(paths.hooksDir, params);
}

export async function prepareCyclePaths(paths: Pick<ResolvedPaths, "base">): Promise<void> {
  await ensureDir(paths.base);
}

// ─── Cron job management via Bun.cron() ───

export async function cronStart(
  schedule: string,
  paths: ResolvedPaths,
): Promise<void> {
  const jobTitle = cronJobTitle(paths.base);
  const previousRuntime = await loadCronRuntime(jobTitle);
  await saveCronRuntime(runtimeFromPaths(paths), jobTitle);

  try {
    await Bun.cron(WORKER_PATH, schedule, jobTitle);
  } catch (err) {
    if (previousRuntime) {
      await saveCronRuntime(previousRuntime, jobTitle);
    } else {
      await clearCronRuntime(jobTitle);
    }
    throw err;
  }

  outputInfo(`Cron registered: "${schedule}" (${jobTitle})`);
}

export async function cronStop(baseDir: string): Promise<void> {
  const jobTitle = cronJobTitle(baseDir);
  await Bun.cron.remove(jobTitle);
  await clearCronRuntime(jobTitle);
  outputInfo("Cron job removed.");
}

export function cronNextRun(schedule: string): Date | null {
  return Bun.cron.parse(schedule);
}

export interface CronStatus {
  jobTitle: string;
  registered: boolean;
  schedule: string | null;
  nextRun: Date | null;
  runtimeState: CronRuntimeState["status"] | null;
  runtime: CronRuntime | null;
}

export async function cronStatus(baseDir: string): Promise<CronStatus> {
  const jobTitle = cronJobTitle(baseDir);
  const platform = process.platform;

  if (platform === "darwin") {
    return await cronStatusMacOS(jobTitle);
  }
  if (platform === "linux") {
    return await cronStatusLinux(jobTitle);
  }

  return {
    jobTitle,
    registered: false,
    schedule: null,
    nextRun: null,
    runtimeState: null,
    runtime: null,
  };
}

async function cronStatusMacOS(jobTitle: string): Promise<CronStatus> {
  // Bun.cron registers as ~/Library/LaunchAgents/bun.cron.<title>.plist
  const plistPath = `${process.env.HOME}/Library/LaunchAgents/bun.cron.${jobTitle}.plist`;
  const exists = await Bun.file(plistPath).exists();
  if (!exists) {
    return {
      jobTitle,
      registered: false,
      schedule: null,
      nextRun: null,
      runtimeState: null,
      runtime: null,
    };
  }

  // Check if loaded in launchctl
  const proc = Bun.spawn(["launchctl", "list"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(proc.stdout).text();
  const registered = output.includes(`bun.cron.${jobTitle}`);

  // Extract schedule from plist to compute next run
  const schedule = await extractScheduleFromPlist(plistPath);
  const nextRun = schedule ? Bun.cron.parse(schedule) : null;
  const runtimeState = registered ? await loadCronRuntimeState(jobTitle) : null;

  return {
    jobTitle,
    registered,
    schedule,
    nextRun,
    runtimeState: runtimeState?.status ?? null,
    runtime: runtimeState?.runtime ?? null,
  };
}

async function extractScheduleFromPlist(plistPath: string): Promise<string | null> {
  try {
    const content = await Bun.file(plistPath).text();
    // Bun embeds the cron expression in the ProgramArguments as --cron-period='<schedule>'
    const match = content.match(/--cron-period='([^']+)'/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function cronStatusLinux(jobTitle: string): Promise<CronStatus> {
  // Bun.cron adds entries with "# bun-cron: <title>" marker
  const proc = Bun.spawn(["crontab", "-l"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(proc.stdout).text();
  const lines = output.split("\n");

  let foundMarker = false;
  for (const line of lines) {
    if (line.trim() === `# bun-cron: ${jobTitle}`) {
      foundMarker = true;
      continue;
    }
    if (foundMarker && line.trim()) {
      // The line after the marker is the crontab entry
      // Format: <schedule fields> '<bun-path>' run --cron-title=... --cron-period='<schedule>' '<script>'
      const periodMatch = line.match(/--cron-period='([^']+)'/);
      const schedule = periodMatch?.[1] ?? null;
      const nextRun = schedule ? Bun.cron.parse(schedule) : null;
      const runtimeState = await loadCronRuntimeState(jobTitle);
      return {
        jobTitle,
        registered: true,
        schedule,
        nextRun,
        runtimeState: runtimeState.status,
        runtime: runtimeState.runtime,
      };
    }
  }

  return {
    jobTitle,
    registered: false,
    schedule: null,
    nextRun: null,
    runtimeState: null,
    runtime: null,
  };
}
