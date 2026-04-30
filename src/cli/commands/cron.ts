import type { ParsedArgs } from "../args.ts";
import { UsageError } from "../args.ts";
import { output, outputText } from "../output.ts";
import { resolvePaths } from "../../paths.ts";
import {
  cronRepair,
  intervalToCron,
  runCycle,
  cronStart,
  cronStop,
  cronStatus,
  cronNextRun,
  prepareCyclePaths,
} from "../../cron/index.ts";
import { cronRuntimeStateDisplay } from "../../cron/runtime.ts";

const DEFAULT_INTERVAL = "30m";

const CRON_HELP = `feeds cron — scheduled feed scanning

Usage:
  feeds cron start [--interval 30m]   Register OS cron job with current runtime
  feeds cron stop                     Remove OS cron job
  feeds cron status                   Show cron job status and runtime
  feeds cron repair --interval 30m    Rebuild legacy runtime state with current schema
                                      Use --no-hooks for hooks-enabled legacy state
  feeds cron check                    Exit non-zero when cron health is not OK
  feeds cron run                      Run one scan cycle (foreground)

Global options:
  --base-dir <path>                   Base directory for config, db, and hooks
  --config <path>                     Config file path override
  --db <path>                         Database file path override
  --no-hooks                          Disable cron hooks for this run or saved cron runtime`;

export function renderCronCheck(status: Awaited<ReturnType<typeof cronStatus>>): string {
  if (status.check.ok) {
    return `cron ok: ${status.jobTitle}`;
  }

  const lines = [`cron check failed: ${status.jobTitle}`];
  for (const issue of status.check.issues) {
    lines.push(`- ${issue.code}: ${issue.message}`);
  }
  return lines.join("\n");
}

export function renderCronStatus(status: Awaited<ReturnType<typeof cronStatus>>): string {
  if (!status.registered) {
    return "feeds cron: not registered";
  }

  const lines = ["feeds cron: registered"];
  lines.push(`  job title:     ${status.jobTitle}`);
  if (status.heartbeatSchedule) {
    lines.push(`  heartbeat:     ${status.heartbeatSchedule}`);
  }
  if (status.nextHeartbeatRun) {
    lines.push(`  next tick:     ${status.nextHeartbeatRun.toISOString()}`);
  }
  if (status.runtimeState && status.runtimeState !== "ok") {
    lines.push(`  runtime state: ${cronRuntimeStateDisplay(status.runtimeState)}`);
    lines.push("  runtime:       unavailable");
    return lines.join("\n");
  }
  if (status.runtime) {
    lines.push(`  base dir:      ${status.runtime.baseDir}`);
    lines.push(`  config:        ${status.runtime.config}`);
    lines.push(`  db:            ${status.runtime.db}`);
    lines.push(
      `  hooks:         ${status.runtime.hooksEnabled ? "enabled" : "disabled"}`,
    );
    lines.push(`  hooks dir:     ${status.runtime.hooksDir}`);
    if (status.runtime.jobs.length > 0) {
      const schedules = status.runtime.jobs.map((job) =>
        job.schedule.kind === "interval" ? job.schedule.every : job.schedule.expression
      );
      lines.push(`  scan jobs:     ${schedules.join(", ")}`);
    }
  }
  for (const health of status.execution) {
    lines.push(`  health:        ${health.status}`);
    if (health.lastStartedAt) lines.push(`  last started:  ${health.lastStartedAt}`);
    if (health.lastSuccessAt) lines.push(`  last success:  ${health.lastSuccessAt}`);
    if (health.lastErrorAt) lines.push(`  last error:    ${health.lastErrorAt}`);
    if (health.consecutiveFailures > 0) {
      lines.push(`  failures:      ${health.consecutiveFailures}`);
    }
  }
  lines.push(`  pending events:${String(status.pendingEvents).padStart(2, " ")}`);
  lines.push(`  failed events: ${String(status.failedEvents).padStart(2, " ")}`);
  lines.push(`  failed hooks:  ${String(status.failedHookRuns).padStart(2, " ")}`);
  return lines.join("\n");
}

export async function cronCommand(args: ParsedArgs): Promise<void> {
  const subcommand = args.positionals[0];

  if (!subcommand || args.flags.help) {
    outputText(CRON_HELP);
    return;
  }

  switch (subcommand) {
    case "start": {
      const intervalStr = args.flags.interval ?? DEFAULT_INTERVAL;
      intervalToCron(intervalStr);
      const paths = resolvePaths(args.flags);
      await cronStart(intervalStr, paths);
      const next = cronNextRun("* * * * *");
      if (next) {
        outputText(`Next heartbeat tick: ${next.toISOString()}`);
      }
      break;
    }
    case "stop":
      await cronStop(resolvePaths(args.flags).base);
      break;
    case "status": {
      const status = await cronStatus(resolvePaths(args.flags).base);
      output(status, args.flags.format, renderCronStatus);
      break;
    }
    case "repair": {
      const intervalStr = args.flags.interval;
      if (!intervalStr) {
        throw new UsageError(
          "Usage: feeds cron repair --interval <value>\nLegacy runtime state does not store scan schedule, so --interval is required.",
        );
      }
      const runtime = await cronRepair(resolvePaths(args.flags).base, intervalStr, {
        hooksEnabled: args.flags.noHooks ? false : undefined,
      });
      outputText(
        `Cron runtime repaired with scan interval ${intervalStr} for ${runtime.baseDir}`
          + (runtime.hooksEnabled ? "" : " (hooks disabled)"),
      );
      break;
    }
    case "check": {
      const status = await cronStatus(resolvePaths(args.flags).base);
      output(status, args.flags.format, renderCronCheck);
      process.exitCode = status.check.exitCode;
      break;
    }
    case "run": {
      const paths = resolvePaths(args.flags);
      await prepareCyclePaths(paths);
      await runCycle(paths);
      break;
    }
    default:
      throw new UsageError(
        `Unknown cron subcommand: ${subcommand}\n${CRON_HELP}`,
      );
  }
}
