import { join, dirname } from "node:path";
import { outputInfo, outputWarn, outputError } from "../cli/output.ts";
import { loadConfig } from "../config/index.ts";
import { FeedDatabase } from "../db/index.ts";
import { scanFeed, type ScanResult } from "../scanner.ts";
import { type ResolvedPaths } from "../paths.ts";
import { runHooks } from "./hooks.ts";

const CRON_JOB_TITLE = "feeds-cli";
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
 */
export async function runCycle(paths: ResolvedPaths): Promise<void> {
  const cycleStart = performance.now();
  const config = await loadConfig(paths.config);

  if (config.feeds.length === 0) {
    outputWarn("No feeds in config, skipping cycle.");
    return;
  }

  using db = new FeedDatabase(paths.db);
  let totalNew = 0;

  for (const feedDef of config.feeds) {
    const feedEnv = {
      FEEDS_FEED_NAME: feedDef.name,
      FEEDS_FEED_ID: feedDef.id ?? "",
    };

    await runHooks(paths.hooksDir, {
      event: "scan-start",
      env: feedEnv,
    });

    let result: ScanResult;
    try {
      result = await scanFeed(db, feedDef);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outputError(`Scan failed for ${feedDef.name}: ${message}`);
      await runHooks(paths.hooksDir, {
        event: "scan-error",
        env: { ...feedEnv, FEEDS_ERROR_MESSAGE: message },
      });
      continue;
    }

    await runHooks(paths.hooksDir, {
      event: "scan-complete",
      env: {
        ...feedEnv,
        FEEDS_ARTICLE_COUNT: String(result.articlesFound),
        FEEDS_NEW_ARTICLE_COUNT: String(result.articlesInserted),
      },
    });

    if (result.newArticles.length > 0) {
      const json = JSON.stringify(result.newArticles);
      await runHooks(paths.hooksDir, {
        event: "new-articles",
        env: {
          ...feedEnv,
          FEEDS_NEW_ARTICLES_JSON: json,
        },
        stdin: json,
      });
    }

    totalNew += result.articlesInserted;

    for (const err of result.errors) {
      outputWarn(err);
    }

    outputInfo(
      `${result.feedName}: ${result.articlesInserted} new / ${result.articlesFound} found`,
    );
  }

  const durationMs = Math.round(performance.now() - cycleStart);

  await runHooks(paths.hooksDir, {
    event: "cycle-complete",
    env: {
      FEEDS_TOTAL_FEEDS: String(config.feeds.length),
      FEEDS_TOTAL_NEW_ARTICLES: String(totalNew),
      FEEDS_CYCLE_DURATION_MS: String(durationMs),
    },
  });

  outputInfo(`Cycle complete: ${totalNew} new articles in ${durationMs}ms`);
}

// ─── Cron job management via Bun.cron() ───

export async function cronStart(schedule: string): Promise<void> {
  await Bun.cron(WORKER_PATH, schedule, CRON_JOB_TITLE);
  outputInfo(`Cron registered: "${schedule}" (${CRON_JOB_TITLE})`);
}

export async function cronStop(): Promise<void> {
  await Bun.cron.remove(CRON_JOB_TITLE);
  outputInfo("Cron job removed.");
}

export function cronNextRun(schedule: string): Date | null {
  return Bun.cron.parse(schedule);
}

export interface CronStatus {
  registered: boolean;
  schedule: string | null;
  nextRun: Date | null;
}

export async function cronStatus(): Promise<CronStatus> {
  const platform = process.platform;

  if (platform === "darwin") {
    return await cronStatusMacOS();
  }
  if (platform === "linux") {
    return await cronStatusLinux();
  }

  return { registered: false, schedule: null, nextRun: null };
}

async function cronStatusMacOS(): Promise<CronStatus> {
  // Bun.cron registers as ~/Library/LaunchAgents/bun.cron.<title>.plist
  const plistPath = `${process.env.HOME}/Library/LaunchAgents/bun.cron.${CRON_JOB_TITLE}.plist`;
  const exists = await Bun.file(plistPath).exists();
  if (!exists) {
    return { registered: false, schedule: null, nextRun: null };
  }

  // Check if loaded in launchctl
  const proc = Bun.spawn(["launchctl", "list"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(proc.stdout).text();
  const registered = output.includes(`bun.cron.${CRON_JOB_TITLE}`);

  // Extract schedule from plist to compute next run
  const schedule = await extractScheduleFromPlist(plistPath);
  const nextRun = schedule ? Bun.cron.parse(schedule) : null;

  return { registered, schedule, nextRun };
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

async function cronStatusLinux(): Promise<CronStatus> {
  // Bun.cron adds entries with "# bun-cron: <title>" marker
  const proc = Bun.spawn(["crontab", "-l"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(proc.stdout).text();
  const lines = output.split("\n");

  let foundMarker = false;
  for (const line of lines) {
    if (line.trim() === `# bun-cron: ${CRON_JOB_TITLE}`) {
      foundMarker = true;
      continue;
    }
    if (foundMarker && line.trim()) {
      // The line after the marker is the crontab entry
      // Format: <schedule fields> '<bun-path>' run --cron-title=... --cron-period='<schedule>' '<script>'
      const periodMatch = line.match(/--cron-period='([^']+)'/);
      const schedule = periodMatch?.[1] ?? null;
      const nextRun = schedule ? Bun.cron.parse(schedule) : null;
      return { registered: true, schedule, nextRun };
    }
  }

  return { registered: false, schedule: null, nextRun: null };
}
