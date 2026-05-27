import type { EntryDiscoveredPayload } from "../contracts/event.ts";
import type {
  ConfigFile,
  HookEntryField,
  HookEntryRule,
  SourceHooksConfig,
} from "../types.ts";

export const HOOK_ENTRY_FIELDS = ["title", "url", "summary"] as const satisfies readonly HookEntryField[];

type HookEntry = Pick<EntryDiscoveredPayload, "title" | "url" | "summary">;

export function sourceHookConfigsFromConfig(
  config: ConfigFile,
): ReadonlyMap<string, SourceHooksConfig> {
  const sourceHooks = new Map<string, SourceHooksConfig>();

  for (const feed of config.feeds) {
    for (const source of feed.sources) {
      if (source.id && source.hooks) {
        sourceHooks.set(source.id, source.hooks);
      }
    }
  }

  return sourceHooks;
}

export function shouldDispatchEntryHooks(
  entry: HookEntry,
  hooks?: SourceHooksConfig,
): boolean {
  if (!hooks) return true;

  if (hooks.include?.length && !hooks.include.some((rule) => matchesRule(entry, rule))) {
    return false;
  }

  if (hooks.exclude?.some((rule) => matchesRule(entry, rule))) {
    return false;
  }

  return true;
}

export function compileHookPattern(pattern: string): RegExp {
  const trimmed = pattern.trim();
  const literal = parseRegexLiteral(trimmed);
  return literal ?? new RegExp(trimmed);
}

function matchesRule(entry: HookEntry, rule: HookEntryRule): boolean {
  let matchedFields = 0;

  for (const field of HOOK_ENTRY_FIELDS) {
    const pattern = rule[field];
    if (!pattern) continue;

    matchedFields++;
    const value = entry[field] ?? "";
    if (!compileHookPattern(pattern).test(value)) {
      return false;
    }
  }

  return matchedFields > 0;
}

function parseRegexLiteral(input: string): RegExp | null {
  if (!input.startsWith("/") || input.length < 2) {
    return null;
  }

  const separatorIndex = findLastUnescapedSlash(input);
  if (separatorIndex <= 0) {
    return null;
  }

  const flags = input.slice(separatorIndex + 1);
  if (!/^[dgimsuvy]*$/.test(flags)) {
    return null;
  }

  return new RegExp(input.slice(1, separatorIndex), flags);
}

function findLastUnescapedSlash(input: string): number {
  for (let i = input.length - 1; i > 0; i--) {
    if (input[i] === "/" && !isEscaped(input, i)) {
      return i;
    }
  }

  return -1;
}

function isEscaped(input: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && input[i] === "\\"; i--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}
