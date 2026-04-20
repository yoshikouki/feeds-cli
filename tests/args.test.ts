import { describe, test, expect } from "bun:test";
import { parseArgs } from "../src/cli/args";

describe("parseArgs", () => {
  test("parses base-dir and no-hooks flags", () => {
    const args = parseArgs([
      "bun",
      "src/cli.ts",
      "scan",
      "--all",
      "--base-dir",
      "/tmp/feeds-cli",
      "--no-hooks",
    ]);

    expect(args.command).toBe("scan");
    expect(args.flags.all).toBe(true);
    expect(args.flags.baseDir).toBe("/tmp/feeds-cli");
    expect(args.flags.noHooks).toBe(true);
  });

  test("keeps config and db overrides independent from base-dir", () => {
    const args = parseArgs([
      "bun",
      "src/cli.ts",
      "cron",
      "run",
      "--base-dir",
      "/tmp/base",
      "--config",
      "/tmp/custom.json5",
      "--db",
      "/tmp/custom.db",
    ]);

    expect(args.command).toBe("cron");
    expect(args.positionals).toEqual(["run"]);
    expect(args.flags.baseDir).toBe("/tmp/base");
    expect(args.flags.config).toBe("/tmp/custom.json5");
    expect(args.flags.db).toBe("/tmp/custom.db");
    expect(args.flags.noHooks).toBe(false);
  });
});
