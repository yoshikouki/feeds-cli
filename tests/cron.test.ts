import { describe, test, expect } from "bun:test";
import { parseInterval } from "../src/cron/index";

describe("parseInterval", () => {
  test("parses seconds", () => {
    expect(parseInterval("90s")).toBe(90_000);
  });

  test("parses minutes", () => {
    expect(parseInterval("30m")).toBe(30 * 60_000);
  });

  test("parses hours", () => {
    expect(parseInterval("2h")).toBe(2 * 3_600_000);
  });

  test("rejects invalid format", () => {
    expect(() => parseInterval("abc")).toThrow("Invalid interval");
    expect(() => parseInterval("30")).toThrow("Invalid interval");
    expect(() => parseInterval("30d")).toThrow("Invalid interval");
    expect(() => parseInterval("")).toThrow("Invalid interval");
  });
});
