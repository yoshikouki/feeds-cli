import { outputError } from "../cli/output.ts";
import { prepareCyclePaths, runCycle } from "./index.ts";
import { resolveCronPaths } from "./runtime.ts";
import { currentCronJobTitle } from "./job-id.ts";

export default {
  async scheduled(controller: Bun.CronController) {
    try {
      const jobTitle = currentCronJobTitle(controller);
      const paths = await resolveCronPaths(jobTitle);
      await prepareCyclePaths(paths);
      await runCycle(paths, "cron");
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
