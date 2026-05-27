import {
  CliError,
  type CliDiagnosticContext,
} from "./diagnostic.ts";

export type Format = "human" | "json";

export interface ParsedArgs {
  command: string | null;
  positionals: string[];
  flags: {
    baseDir?: string;
    config?: string;
    db?: string;
    format: Format;
    help: boolean;
    noHooks: boolean;
    noSeed: boolean;
    version: boolean;
    // command-specific
    name?: string;
    all: boolean;
    unread: boolean;
    limit?: number;
    search?: string;
    since?: string;
    tag?: string;
    interval?: string;
    feed?: string;
    sitemapInclude?: string[];
    sitemapExclude?: string[];
  };
}

const FLAG_ALIASES: Record<string, string> = {
  "-h": "--help",
  "-v": "--version",
  "-n": "--name",
  "-a": "--all",
  "-f": "--format",
  "-l": "--limit",
  "-s": "--search",
};

const FLAGS_WITH_VALUE = new Set([
  "--base-dir",
  "--config",
  "--db",
  "--format",
  "--name",
  "--limit",
  "--search",
  "--since",
  "--tag",
  "--interval",
  "--feed",
  "--sitemap-include",
  "--sitemap-exclude",
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const raw = argv.slice(2); // skip bun binary + script path
  const result: ParsedArgs = {
    command: null,
    positionals: [],
    flags: {
      format: "human",
      help: false,
      noHooks: false,
      noSeed: false,
      version: false,
      all: false,
      unread: false,
    },
  };

  let i = 0;
  while (i < raw.length) {
    let token = raw[i]!;

    // resolve aliases
    if (FLAG_ALIASES[token]) {
      token = FLAG_ALIASES[token]!;
    }

    if (token === "--help") {
      result.flags.help = true;
    } else if (token === "--no-hooks") {
      result.flags.noHooks = true;
    } else if (token === "--no-seed") {
      result.flags.noSeed = true;
    } else if (token === "--version") {
      result.flags.version = true;
    } else if (token === "--json") {
      result.flags.format = "json";
    } else if (token === "--all") {
      result.flags.all = true;
    } else if (token === "--unread") {
      result.flags.unread = true;
    } else if (FLAGS_WITH_VALUE.has(token)) {
      const value = raw[++i];
      if (value === undefined) {
        throw new UsageError(`Flag ${token} requires a value`, {
          code: "usage.missing_flag_value",
          reason: "The flag requires a value but none was provided.",
          suggestedAction: `Provide a value after ${token}.`,
          context: { flag: token },
        });
      }
      const key = token.slice(2); // strip --
      switch (key) {
        case "base-dir":
          result.flags.baseDir = value;
          break;
        case "config":
          result.flags.config = value;
          break;
        case "db":
          result.flags.db = value;
          break;
        case "format":
          if (value !== "json" && value !== "human") {
            throw new UsageError(`Invalid format: ${value} (expected json or human)`, {
              code: "usage.invalid_flag_value",
              reason: "The --format flag only accepts json or human.",
              suggestedAction: "Use --json, --format json, or --format human.",
              context: { flag: "--format", value },
            });
          }
          result.flags.format = value;
          break;
        case "name":
          result.flags.name = value;
          break;
        case "limit":
          result.flags.limit = Number(value);
          if (!Number.isFinite(result.flags.limit) || result.flags.limit < 1) {
            throw new UsageError(`Invalid limit: ${value}`, {
              code: "usage.invalid_flag_value",
              reason: "The --limit flag must be a positive number.",
              suggestedAction: "Pass a positive number to --limit.",
              context: { flag: "--limit", value },
            });
          }
          break;
        case "search":
          result.flags.search = value;
          break;
        case "since":
          result.flags.since = value;
          break;
        case "tag":
          result.flags.tag = value;
          break;
        case "interval":
          result.flags.interval = value;
          break;
        case "feed":
          result.flags.feed = value;
          break;
        case "sitemap-include":
          result.flags.sitemapInclude = [...(result.flags.sitemapInclude ?? []), value];
          break;
        case "sitemap-exclude":
          result.flags.sitemapExclude = [...(result.flags.sitemapExclude ?? []), value];
          break;
      }
    } else if (token.startsWith("-")) {
      throw new UsageError(`Unknown flag: ${token}`, {
        code: "usage.unknown_flag",
        reason: "The flag is not recognized by feeds-cli.",
        suggestedAction: "Run 'feeds --help' to list supported flags.",
        context: { flag: token },
      });
    } else if (result.command === null) {
      result.command = token;
    } else {
      result.positionals.push(token);
    }

    i++;
  }

  return result;
}

export interface UsageErrorOptions {
  readonly code?: string;
  readonly reason?: string;
  readonly suggestedAction?: string;
  readonly context?: CliDiagnosticContext;
}

export class UsageError extends CliError {
  constructor(message: string, options: UsageErrorOptions = {}) {
    super(message, {
      code: options.code ?? "usage.invalid",
      category: "usage",
      reason: options.reason ?? "The provided arguments do not match the CLI contract.",
      suggestedAction: options.suggestedAction
        ?? "Run 'feeds --help' or the command help, then retry with valid arguments.",
      exitCode: 2,
      context: options.context,
    });
    this.name = "UsageError";
  }
}
