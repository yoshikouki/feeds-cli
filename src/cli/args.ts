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
    } else if (token === "--version") {
      result.flags.version = true;
    } else if (token === "--all") {
      result.flags.all = true;
    } else if (token === "--unread") {
      result.flags.unread = true;
    } else if (FLAGS_WITH_VALUE.has(token)) {
      const value = raw[++i];
      if (value === undefined) {
        throw new UsageError(`Flag ${token} requires a value`);
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
            throw new UsageError(`Invalid format: ${value} (expected json or human)`);
          }
          result.flags.format = value;
          break;
        case "name":
          result.flags.name = value;
          break;
        case "limit":
          result.flags.limit = Number(value);
          if (!Number.isFinite(result.flags.limit) || result.flags.limit < 1) {
            throw new UsageError(`Invalid limit: ${value}`);
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
      }
    } else if (token.startsWith("-")) {
      throw new UsageError(`Unknown flag: ${token}`);
    } else if (result.command === null) {
      result.command = token;
    } else {
      result.positionals.push(token);
    }

    i++;
  }

  return result;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}
