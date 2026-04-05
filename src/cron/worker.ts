import { resolvePaths } from "../paths.ts";
import { runCycle } from "./index.ts";

export default {
  async scheduled(controller: Bun.CronController) {
    const paths = resolvePaths();
    await runCycle(paths);
  },
};
