import { describe, expect, test } from "bun:test";
import { UsageError } from "../src/cli/args";
import { CliError } from "../src/cli/diagnostic";
import { formatCliDiagnosticText, formatCliError } from "../src/cli/output";

describe("formatCliError", () => {
  test("formats usage errors as a stable diagnostic", () => {
    const error = formatCliError(
      new UsageError("Unknown flag: --wat", {
        code: "usage.unknown_flag",
        reason: "The flag is not recognized by feeds-cli.",
        suggestedAction: "Run 'feeds --help' to list supported flags.",
        context: { flag: "--wat" },
      }),
      2,
    );

    expect(error.error).toEqual({
      schemaVersion: 1,
      code: "usage.unknown_flag",
      category: "usage",
      summary: "Unknown flag: --wat",
      reason: "The flag is not recognized by feeds-cli.",
      suggestedAction: "Run 'feeds --help' to list supported flags.",
      exitCode: 2,
      context: { flag: "--wat" },
    });
  });

  test("formats typed runtime errors as diagnostics", () => {
    const error = formatCliError(
      new CliError("Feed not found in config: missing", {
        code: "config.feed_not_found",
        category: "config",
        reason: "No registered feed matches the requested name.",
        suggestedAction: "Run 'feeds feeds' to list registered feeds.",
        context: { feedName: "missing" },
      }),
      1,
    );

    expect(error.error).toEqual({
      schemaVersion: 1,
      code: "config.feed_not_found",
      category: "config",
      summary: "Feed not found in config: missing",
      reason: "No registered feed matches the requested name.",
      suggestedAction: "Run 'feeds feeds' to list registered feeds.",
      exitCode: 1,
      context: { feedName: "missing" },
    });
  });

  test("falls back for untyped errors without dropping summary reason and action", () => {
    const error = formatCliError(new Error("database is locked"), 1);

    expect(error.error).toEqual({
      schemaVersion: 1,
      code: "runtime.unexpected",
      category: "runtime",
      summary: "database is locked",
      reason: "The command failed before a more specific diagnostic was reported.",
      suggestedAction: "Inspect the error message and retry after fixing the underlying condition.",
      exitCode: 1,
    });
  });

  test("renders non-JSON diagnostics with error reason and next action", () => {
    const formatted = formatCliDiagnosticText(
      formatCliError(
        new UsageError("Unknown flag: --wat", {
          code: "usage.unknown_flag",
          reason: "The flag is not recognized by feeds-cli.",
          suggestedAction: "Run 'feeds --help' to list supported flags.",
          context: { flag: "--wat" },
        }),
        2,
      ).error,
    );

    expect(formatted).toBe(
      [
        "error[usage.unknown_flag]: Unknown flag: --wat",
        "reason: The flag is not recognized by feeds-cli.",
        "next: Run 'feeds --help' to list supported flags.",
        "context:",
        "  flag: --wat",
      ].join("\n"),
    );
  });
});
