import { dirname } from "node:path";
import { outputInfo, outputWarn, outputError } from "../cli/output.ts";
import { loadConfig } from "../config/index.ts";
import { FeedDatabase } from "../db/index.ts";
import { scanFeed, type ScanResult } from "../scanner.ts";
import { ensureDir, type ResolvedPaths } from "../paths.ts";
import { runHooks } from "./hooks.ts";

/**
 * Parse an interval string like "30m", "1h", "90s" into milliseconds.
 */
export function parseInterval(input: string): number {
  const match = input.match(/^(\d+)(s|m|h)$/);
  if (!match) throw new Error(`Invalid interval: ${input} (use e.g. 30m, 1h, 90s)`);
  const value = Number(match[1]);
  const unit = match[2];
  switch (unit) {
    case "s":
      return value * 1_000;
    case "m":
      return value * 60_000;
    case "h":
      return value * 3_600_000;
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

/**
 * Start the cron loop (foreground). Used by the daemon process.
 */
export async function startLoop(
  paths: ResolvedPaths,
  intervalMs: number,
): Promise<void> {
  outputInfo(
    `feeds-cli cron started (interval: ${intervalMs / 1000}s, PID: ${process.pid})`,
  );

  // Run immediately on start
  await runCycle(paths);

  const timer = setInterval(async () => {
    try {
      await runCycle(paths);
    } catch (err) {
      outputError(
        `Cycle error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, intervalMs);

  // Graceful shutdown
  const shutdown = () => {
    outputInfo("Shutting down feeds-cli cron...");
    clearInterval(timer);
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// ─── Daemon management ───

async function readPid(pidFile: string): Promise<number | null> {
  try {
    const content = await Bun.file(pidFile).text();
    return Number(content.trim()) || null;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function daemonStart(
  paths: ResolvedPaths,
  intervalMs: number,
): Promise<void> {
  await ensureDir(paths.base);
  await ensureDir(dirname(paths.logFile));

  const existingPid = await readPid(paths.pidFile);
  if (existingPid && isProcessRunning(existingPid)) {
    outputError(`Cron daemon already running (PID ${existingPid})`);
    process.exit(1);
  }

  // Spawn self as detached daemon with log output
  const logFile = Bun.file(paths.logFile);
  const proc = Bun.spawn(
    [process.execPath, import.meta.filename, "__daemon", String(intervalMs), paths.config, paths.db],
    {
      detached: true,
      stdin: "ignore",
      stdout: logFile,
      stderr: logFile,
    },
  );
  proc.unref();

  await Bun.write(paths.pidFile, String(proc.pid));
  outputInfo(`Cron daemon started (PID ${proc.pid})`);
}

export async function daemonStop(paths: ResolvedPaths): Promise<void> {
  const pid = await readPid(paths.pidFile);
  if (!pid || !isProcessRunning(pid)) {
    outputInfo("Cron daemon is not running.");
    await cleanPidFile(paths.pidFile);
    return;
  }

  process.kill(pid, "SIGTERM");
  await cleanPidFile(paths.pidFile);
  outputInfo(`Cron daemon stopped (PID ${pid})`);
}

export async function daemonStatus(paths: ResolvedPaths): Promise<string> {
  const pid = await readPid(paths.pidFile);
  if (!pid || !isProcessRunning(pid)) {
    await cleanPidFile(paths.pidFile);
    return "feeds cron: not running";
  }
  return `feeds cron: running (PID ${pid})`;
}

async function cleanPidFile(pidFile: string): Promise<void> {
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(pidFile);
  } catch {
    // ignore
  }
}

// ─── Daemon entry point ───
// When invoked as `bun src/cron/index.ts __daemon <intervalMs> [configOverride] [dbOverride]`

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === "__daemon") {
    const intervalMs = Number(args[1]);
    const configOverride = args[2] !== "undefined" ? args[2] : undefined;
    const dbOverride = args[3] !== "undefined" ? args[3] : undefined;

    const { resolvePaths: resolve } = await import("../paths.ts");
    const paths = resolve({ config: configOverride, db: dbOverride });

    // Redirect output to log file
    await ensureDir(dirname(paths.logFile));

    await startLoop(paths, intervalMs);
  }
}
