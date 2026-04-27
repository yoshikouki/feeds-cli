import type { JobRunRecord } from "../contracts/control-plane.ts";
import type { ScheduledJobSpec } from "../contracts/scheduler.ts";

export const HEARTBEAT_CRON_SCHEDULE = "* * * * *";

export function planDueJobs(
  jobs: readonly ScheduledJobSpec[],
  latestRuns: ReadonlyMap<string, JobRunRecord | null>,
  now: Date = new Date(),
): ScheduledJobSpec[] {
  return jobs.filter((job) => isJobDue(job, latestRuns.get(job.id) ?? null, now));
}

export function isJobDue(
  job: ScheduledJobSpec,
  latestRun: JobRunRecord | null,
  now: Date = new Date(),
): boolean {
  if (!job.enabled) {
    return false;
  }

  if (!latestRun) {
    return true;
  }

  if (latestRun.status === "running" && latestRun.finishedAt === null) {
    return false;
  }

  if (job.schedule.kind !== "interval") {
    return latestRun.status !== "success";
  }

  const intervalMs = intervalToMs(job.schedule.every);
  if (intervalMs === null) {
    return latestRun.status !== "success";
  }

  return now.getTime() - Date.parse(latestRun.startedAt) >= intervalMs;
}

export function intervalToMs(value: string): number | null {
  const match = value.match(/^(\d+)(m|h)$/);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  return match[2] === "h"
    ? amount * 60 * 60 * 1000
    : amount * 60 * 1000;
}
