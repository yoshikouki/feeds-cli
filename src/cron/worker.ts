import { outputError } from "../cli/output.ts";
import { prepareCyclePaths, runCycle } from "./index.ts";
import { resolveCronPaths } from "./runtime.ts";

export default {
  async scheduled(controller: Bun.CronController) {
    try {
      const paths = await resolveCronPaths();
      await prepareCyclePaths(paths);
      await runCycle(paths, "cron");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("Cron runtime state is ")) {
        outputError(`${message}; refusing scheduled run.`);
        return;
      }
      outputError(`Cron cycle crashed: ${message}`);
    }
  },
};
