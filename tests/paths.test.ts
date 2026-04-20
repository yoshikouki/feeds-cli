import { describe, test, expect } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolvePaths } from "../src/paths";

describe("resolvePaths", () => {
  const home = homedir();
  const base = join(home, ".feeds-cli");

  test("defaults to ~/.feeds-cli/", () => {
    const paths = resolvePaths();
    expect(paths.base).toBe(base);
    expect(paths.config).toBe(join(base, "feeds.json5"));
    expect(paths.db).toBe(join(base, "feeds.db"));
    expect(paths.hooksDir).toBe(join(base, "hooks", "cron"));
    expect(paths.hooksEnabled).toBe(true);
  });

  test("base-dir overrides bundled paths", () => {
    const paths = resolvePaths({ baseDir: "/tmp/feeds-cli" });
    expect(paths.base).toBe("/tmp/feeds-cli");
    expect(paths.config).toBe("/tmp/feeds-cli/feeds.json5");
    expect(paths.db).toBe("/tmp/feeds-cli/feeds.db");
    expect(paths.hooksDir).toBe("/tmp/feeds-cli/hooks/cron");
  });

  test("CLI flags override config path", () => {
    const paths = resolvePaths({ config: "/tmp/custom.json5" });
    expect(paths.config).toBe("/tmp/custom.json5");
    expect(paths.db).toBe(join(base, "feeds.db"));
  });

  test("CLI flags override db path", () => {
    const paths = resolvePaths({ db: "/tmp/custom.db" });
    expect(paths.db).toBe("/tmp/custom.db");
  });

  test("CLI flags override both paths", () => {
    const paths = resolvePaths({
      baseDir: "/tmp/feeds-cli",
      config: "/tmp/flag.json5",
      db: "/tmp/flag.db",
    });
    expect(paths.config).toBe("/tmp/flag.json5");
    expect(paths.db).toBe("/tmp/flag.db");
    expect(paths.base).toBe("/tmp/feeds-cli");
    expect(paths.hooksDir).toBe("/tmp/feeds-cli/hooks/cron");
  });

  test("no-hooks disables hook execution", () => {
    const paths = resolvePaths({ noHooks: true });
    expect(paths.hooksEnabled).toBe(false);
  });
});
