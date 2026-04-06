import { outputError } from "../cli/output.ts";
import { resolvePaths } from "../paths.ts";
import { runCycle } from "./index.ts";

export default {
  async scheduled(controller: Bun.CronController) {
    const paths = resolvePaths();
    try {
      await runCycle(paths, "cron");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outputError(`Cron cycle crashed: ${message}`);
    }
  },
};
