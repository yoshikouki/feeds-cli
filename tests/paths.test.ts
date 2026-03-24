import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolvePaths } from "../src/paths";

describe("resolvePaths", () => {
  const envKeys = ["XDG_CONFIG_HOME", "XDG_DATA_HOME"] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envKeys) {
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

  test("defaults to XDG standard paths", () => {
    const paths = resolvePaths();
    const home = homedir();
    expect(paths.configDir).toBe(join(home, ".config", "feeds-cli"));
    expect(paths.dataDir).toBe(join(home, ".local", "share", "feeds-cli"));
    expect(paths.config).toBe(
      join(home, ".config", "feeds-cli", "feeds.json5"),
    );
    expect(paths.db).toBe(
      join(home, ".local", "share", "feeds-cli", "feeds.db"),
    );
  });

  test("XDG_CONFIG_HOME overrides config directory", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-config";
    const paths = resolvePaths();
    expect(paths.configDir).toBe("/tmp/xdg-config/feeds-cli");
    expect(paths.config).toBe("/tmp/xdg-config/feeds-cli/feeds.json5");
    // data dir unaffected
    expect(paths.dataDir).toBe(
      join(homedir(), ".local", "share", "feeds-cli"),
    );
  });

  test("XDG_DATA_HOME overrides data directory", () => {
    process.env.XDG_DATA_HOME = "/tmp/xdg-data";
    const paths = resolvePaths();
    expect(paths.dataDir).toBe("/tmp/xdg-data/feeds-cli");
    expect(paths.db).toBe("/tmp/xdg-data/feeds-cli/feeds.db");
    // config dir unaffected
    expect(paths.configDir).toBe(join(homedir(), ".config", "feeds-cli"));
  });

  test("CLI flags override config path", () => {
    const paths = resolvePaths({ config: "/tmp/custom.json5" });
    expect(paths.config).toBe("/tmp/custom.json5");
    // db uses default
    expect(paths.db).toBe(
      join(homedir(), ".local", "share", "feeds-cli", "feeds.db"),
    );
  });

  test("CLI flags override db path", () => {
    const paths = resolvePaths({ db: "/tmp/custom.db" });
    expect(paths.db).toBe("/tmp/custom.db");
  });

  test("CLI flags take precedence over XDG env vars", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-config";
    process.env.XDG_DATA_HOME = "/tmp/xdg-data";
    const paths = resolvePaths({
      config: "/tmp/flag.json5",
      db: "/tmp/flag.db",
    });
    expect(paths.config).toBe("/tmp/flag.json5");
    expect(paths.db).toBe("/tmp/flag.db");
  });
});
