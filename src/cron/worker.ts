import { outputError } from "../cli/output.ts";
import { planDueJobs } from "../control-plane/heartbeat.ts";
import { FeedDatabase } from "../db/index.ts";
import { prepareCyclePaths, runCycle } from "./index.ts";
import { currentCronJobTitle } from "./job-id.ts";
import {
  cronRuntimeStateError,
  loadCronRuntimeState,
  pathsFromRuntime,
} from "./runtime.ts";

export default {
  async scheduled(controller: Bun.CronController) {
    try {
      const jobTitle = currentCronJobTitle(controller);
      const runtimeState = await loadCronRuntimeState(jobTitle);
      if (runtimeState.status !== "ok") {
        throw new Error(cronRuntimeStateError(runtimeState));
      }

      const runtime = runtimeState.runtime;
      const paths = pathsFromRuntime(runtime);
      await prepareCyclePaths(paths);
      using db = new FeedDatabase(paths.db);
      const latestRuns = new Map(
        runtime.jobs.map((job) => [job.id, db.latestJobRun(job.id)]),
      );
      const dueJobs = planDueJobs(runtime.jobs, latestRuns);

      for (const job of dueJobs) {
        const jobRunId = db.insertJobRun({
          workspaceId: job.workspaceId,
          pipelineId: job.pipelineId,
          jobId: job.id,
          purpose: job.purpose,
          triggeredBy: "heartbeat",
        });

        try {
          if (job.purpose === "scan") {
            await runCycle(paths, "cron", db);
          }
          db.finishJobRun(jobRunId, "success");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          db.finishJobRun(jobRunId, "error", message);
          throw err;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "Cron job title is missing" || message.startsWith("Cron runtime state is ")) {
        outputError(`${message}; refusing scheduled run.`);
        return;
      }
      outputError(`Cron cycle crashed: ${message}`);
    }
  },
};
