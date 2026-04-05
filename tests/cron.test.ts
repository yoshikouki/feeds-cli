import { describe, test, expect } from "bun:test";
import { intervalToCron } from "../src/cron/index";

describe("intervalToCron", () => {
  test("converts minutes to cron expression", () => {
    expect(intervalToCron("15m")).toBe("*/15 * * * *");
    expect(intervalToCron("30m")).toBe("*/30 * * * *");
    expect(intervalToCron("5m")).toBe("*/5 * * * *");
  });

  test("converts hours to cron expression", () => {
    expect(intervalToCron("1h")).toBe("0 * * * *");
    expect(intervalToCron("2h")).toBe("0 */2 * * *");
    expect(intervalToCron("6h")).toBe("0 */6 * * *");
  });

  test("rejects invalid format", () => {
    expect(() => intervalToCron("abc")).toThrow("Invalid interval");
    expect(() => intervalToCron("30")).toThrow("Invalid interval");
    expect(() => intervalToCron("30s")).toThrow("Invalid interval");
    expect(() => intervalToCron("30d")).toThrow("Invalid interval");
    expect(() => intervalToCron("")).toThrow("Invalid interval");
  });
});
