import { outputError } from "../cli/output.ts";
import { runCycle } from "./index.ts";
import { resolveCronPaths } from "./runtime.ts";

export default {
  async scheduled(controller: Bun.CronController) {
    const paths = await resolveCronPaths();
    try {
      await runCycle(paths, "cron");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outputError(`Cron cycle crashed: ${message}`);
    }
  },
};
