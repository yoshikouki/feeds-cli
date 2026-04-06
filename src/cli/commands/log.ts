import type { ParsedArgs } from "../args.ts";
import { output, formatTable, formatDate } from "../output.ts";
import { resolvePaths, ensureDir } from "../../paths.ts";
import { FeedDatabase } from "../../db/index.ts";

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export async function logCommand(args: ParsedArgs): Promise<void> {
  const subcommand = args.positionals[0];
  const paths = resolvePaths(args.flags);
  await ensureDir(paths.base);

  if (subcommand === "scans") {
    await logScans(args, paths);
  } else {
    await logCycles(args, paths);
  }
}

async function logCycles(
  args: ParsedArgs,
  paths: ReturnType<typeof resolvePaths>,
): Promise<void> {
  using db = new FeedDatabase(paths.db);
  const entries = db.listCycleLog({
    limit: args.flags.limit,
    since: args.flags.since,
  });

  output(entries, args.flags.format, (data) => {
    if (data.length === 0) return "No cycle logs found.";
    return formatTable(
      ["STARTED", "STATUS", "TRIGGER", "DURATION"],
      data.map((e) => [
        formatDate(e.startedAt),
        e.status,
        e.triggeredBy,
        formatDuration(e.durationMs),
      ]),
    );
  });
}

async function logScans(
  args: ParsedArgs,
  paths: ReturnType<typeof resolvePaths>,
): Promise<void> {
  using db = new FeedDatabase(paths.db);
  const feedName = args.flags.feed;
  const entries = db.listScanLogAll({
    feedName,
    limit: args.flags.limit,
    since: args.flags.since,
  });

  output(entries, args.flags.format, (data) => {
    if (data.length === 0) return "No scan logs found.";
    return formatTable(
      ["SCANNED AT", "SOURCE", "STATUS", "ARTICLES", "DURATION"],
      data.map((e) => [
        formatDate(e.scannedAt),
        e.feedSourceId.slice(0, 8),
        e.status,
        e.articleCount !== null ? String(e.articleCount) : "—",
        formatDuration(e.durationMs),
      ]),
    );
  });
}
