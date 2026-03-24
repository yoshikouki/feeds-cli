import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolvePaths } from "../src/paths";

describe("resolvePaths", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["FEEDS_CLI_DIR", "FEEDS_CLI_CONFIG", "FEEDS_CLI_DB"]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  test("defaults to ~/feeds-cli/", () => {
    const paths = resolvePaths();
    const expected = join(homedir(), "feeds-cli");
    expect(paths.dir).toBe(expected);
    expect(paths.config).toBe(join(expected, "feeds.json5"));
    expect(paths.db).toBe(join(expected, "feeds.db"));
  });

  test("FEEDS_CLI_DIR overrides base directory", () => {
    process.env.FEEDS_CLI_DIR = "/tmp/custom-feeds";
    const paths = resolvePaths();
    expect(paths.dir).toBe("/tmp/custom-feeds");
    expect(paths.config).toBe("/tmp/custom-feeds/feeds.json5");
    expect(paths.db).toBe("/tmp/custom-feeds/feeds.db");
  });

  test("FEEDS_CLI_CONFIG overrides config path only", () => {
    process.env.FEEDS_CLI_CONFIG = "/tmp/other/config.json5";
    const paths = resolvePaths();
    expect(paths.config).toBe("/tmp/other/config.json5");
    expect(paths.db).toBe(join(homedir(), "feeds-cli", "feeds.db"));
  });

  test("FEEDS_CLI_DB overrides db path only", () => {
    process.env.FEEDS_CLI_DB = "/tmp/other/data.db";
    const paths = resolvePaths();
    expect(paths.db).toBe("/tmp/other/data.db");
    expect(paths.config).toBe(join(homedir(), "feeds-cli", "feeds.json5"));
  });

  test("CLI flags take precedence over env vars", () => {
    process.env.FEEDS_CLI_CONFIG = "/tmp/env-config.json5";
    process.env.FEEDS_CLI_DB = "/tmp/env-data.db";
    const paths = resolvePaths({
      config: "/tmp/flag-config.json5",
      db: "/tmp/flag-data.db",
    });
    expect(paths.config).toBe("/tmp/flag-config.json5");
    expect(paths.db).toBe("/tmp/flag-data.db");
  });

  test("partial flags override only specified paths", () => {
    const paths = resolvePaths({ config: "/tmp/only-config.json5" });
    expect(paths.config).toBe("/tmp/only-config.json5");
    expect(paths.db).toBe(join(homedir(), "feeds-cli", "feeds.db"));
  });
});
