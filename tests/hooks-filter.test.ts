import { describe, expect, test } from "bun:test";
import { shouldDispatchEntryHooks } from "../src/hooks/filter";

const entry = {
  title: "OpenClaw 2026.5.27 stable",
  url: "https://example.com/releases/stable",
  summary: "Stable release",
};

describe("source hook filters", () => {
  test("allows entries when no hook filters are configured", () => {
    expect(shouldDispatchEntryHooks(entry)).toBe(true);
  });

  test("requires at least one include rule when include is configured", () => {
    expect(
      shouldDispatchEntryHooks(entry, {
        include: [{ title: "/stable/i" }],
      }),
    ).toBe(true);

    expect(
      shouldDispatchEntryHooks(entry, {
        include: [{ title: "/beta/i" }],
      }),
    ).toBe(false);
  });

  test("lets exclude override matching include rules", () => {
    expect(
      shouldDispatchEntryHooks(entry, {
        include: [{ title: "/stable/i" }],
        exclude: [{ url: "/releases/stable" }],
      }),
    ).toBe(false);
  });

  test("requires every field in a rule to match", () => {
    expect(
      shouldDispatchEntryHooks(entry, {
        exclude: [{ title: "/stable/i", summary: "/preview/i" }],
      }),
    ).toBe(true);
  });
});
