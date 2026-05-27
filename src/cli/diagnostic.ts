export type CliExitCode = 1 | 2;

export type ErrorCategory =
  | "usage"
  | "config"
  | "runtime"
  | "cron"
  | "hook"
  | "parser"
  | "network"
  | "storage"
  | "data"
  | "internal";

export type CliDiagnosticContext = Record<string, string | number | boolean | null>;

export interface CliDiagnostic {
  readonly schemaVersion: 1;
  readonly code: string;
  readonly category: ErrorCategory;
  readonly summary: string;
  readonly reason: string;
  readonly suggestedAction: string;
  readonly exitCode: CliExitCode;
  readonly context?: CliDiagnosticContext;
}

export interface CliErrorOptions {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly reason: string;
  readonly suggestedAction: string;
  readonly exitCode?: CliExitCode;
  readonly context?: CliDiagnosticContext;
}

export class CliError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly reason: string;
  readonly suggestedAction: string;
  readonly exitCode?: CliExitCode;
  readonly context?: CliDiagnosticContext;

  constructor(message: string, options: CliErrorOptions) {
    super(message);
    this.name = "CliError";
    this.code = options.code;
    this.category = options.category;
    this.reason = options.reason;
    this.suggestedAction = options.suggestedAction;
    this.exitCode = options.exitCode;
    this.context = options.context;
  }
}

export function toCliDiagnostic(
  error: unknown,
  fallbackExitCode: CliExitCode,
): CliDiagnostic {
  if (error instanceof CliError) {
    return {
      schemaVersion: 1,
      code: error.code,
      category: error.category,
      summary: firstLine(error.message),
      reason: error.reason,
      suggestedAction: error.suggestedAction,
      exitCode: error.exitCode ?? fallbackExitCode,
      ...(error.context ? { context: error.context } : {}),
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    schemaVersion: 1,
    code: "runtime.unexpected",
    category: "runtime",
    summary: firstLine(message),
    reason: "The command failed before a more specific diagnostic was reported.",
    suggestedAction: "Inspect the error message and retry after fixing the underlying condition.",
    exitCode: fallbackExitCode,
  };
}

function firstLine(message: string): string {
  return message.split("\n", 1)[0] ?? message;
}
