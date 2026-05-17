import type { ParsedArgs } from "../args.ts";
import { UsageError } from "../args.ts";
import { output, formatTable, formatDate } from "../output.ts";
import { resolvePaths, ensureDir } from "../../paths.ts";
import { FeedDatabase } from "../../db/index.ts";
import { workspaceIdFromBaseDir } from "../../control-plane/identity.ts";

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export async function logCommand(args: ParsedArgs): Promise<void> {
  const subcommand = args.positionals[0] ?? "cycles";
  const paths = resolvePaths(args.flags);
  await ensureDir(paths.base);

  switch (subcommand) {
    case "cycles":
      await logCycles(args, paths);
      return;
    case "scans":
      await logScans(args, paths);
      return;
    case "events":
      await logEvents(args, paths);
      return;
    case "hooks":
      await logHooks(args, paths);
      return;
    case "jobs":
      await logJobs(args, paths);
      return;
    default:
      throw new UsageError(`Unknown log subcommand: ${subcommand}`);
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

async function logEvents(
  args: ParsedArgs,
  paths: ReturnType<typeof resolvePaths>,
): Promise<void> {
  using db = new FeedDatabase(paths.db);
  const workspaceId = workspaceIdFromBaseDir(paths.base);
  const entries = db.listEvents({
    workspaceId,
    limit: args.flags.limit,
    since: args.flags.since,
  });

  output(entries, args.flags.format, (data) => {
    if (data.length === 0) return "No events found.";
    return formatTable(
      ["OCCURRED", "STATUS", "KIND", "EVENT", "ATTEMPTS", "LAST ERROR"],
      data.map((e) => [
        formatDate(e.event.occurredAt),
        e.status,
        e.event.kind,
        shortId(e.event.id),
        String(e.attemptCount),
        e.lastError ?? "—",
      ]),
    );
  });
}

async function logHooks(
  args: ParsedArgs,
  paths: ReturnType<typeof resolvePaths>,
): Promise<void> {
  using db = new FeedDatabase(paths.db);
  const workspaceId = workspaceIdFromBaseDir(paths.base);
  const entries = db.listHookRuns({
    workspaceId,
    limit: args.flags.limit,
    since: args.flags.since,
  });

  output(entries, args.flags.format, (data) => {
    if (data.length === 0) return "No hook runs found.";
    return formatTable(
      ["STARTED", "STATUS", "HOOK", "EVENT", "ATTEMPT", "EXIT", "DURATION"],
      data.map((e) => [
        formatDate(e.startedAt),
        e.status,
        e.hookKey,
        shortId(e.eventId),
        String(e.attempt),
        e.exitCode !== null ? String(e.exitCode) : "—",
        formatDuration(e.durationMs),
      ]),
    );
  });
}

async function logJobs(
  args: ParsedArgs,
  paths: ReturnType<typeof resolvePaths>,
): Promise<void> {
  using db = new FeedDatabase(paths.db);
  const workspaceId = workspaceIdFromBaseDir(paths.base);
  const entries = db.listJobRuns({
    workspaceId,
    limit: args.flags.limit,
    since: args.flags.since,
  });

  output(entries, args.flags.format, (data) => {
    if (data.length === 0) return "No job runs found.";
    return formatTable(
      ["STARTED", "STATUS", "JOB", "TRIGGER", "DURATION"],
      data.map((e) => [
        formatDate(e.startedAt),
        e.status,
        e.jobId,
        e.triggeredBy,
        formatDuration(e.durationMs),
      ]),
    );
  });
}

function shortId(value: string): string {
  return value.slice(0, 8);
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
