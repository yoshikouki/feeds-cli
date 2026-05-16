import { describe, expect, test } from "bun:test";
import { UsageError } from "../src/cli/args";
import { formatCliError } from "../src/cli/output";

describe("formatCliError", () => {
  test("formats usage errors with what why how details", () => {
    const error = formatCliError(
      new UsageError("Unknown flag: --wat\nRun 'feeds --help' for usage."),
      2,
    );

    expect(error.error.code).toBe("usage_error");
    expect(error.error.what).toBe("Unknown flag: --wat");
    expect(error.error.why).toBe("The provided arguments do not match the CLI contract.");
    expect(error.error.how).toBe(
      "Run 'feeds --help' or the command help, then retry with valid arguments.",
    );
    expect(error.error.details).toEqual({
      message: "Unknown flag: --wat\nRun 'feeds --help' for usage.",
      exitCode: 2,
    });
  });

  test("formats runtime errors separately from usage errors", () => {
    const error = formatCliError(new Error("Feed not found in config: missing"), 1);

    expect(error.error.code).toBe("runtime_error");
    expect(error.error.what).toBe("Feed not found in config: missing");
    expect(error.error.why).toBe("The command failed while executing.");
    expect(error.error.how).toBe(
      "Fix the underlying condition from the error message, then retry the command.",
    );
    expect(error.error.details).toEqual({
      message: "Feed not found in config: missing",
      exitCode: 1,
    });
  });
});
