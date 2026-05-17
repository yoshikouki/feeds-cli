import type { Format } from "./args.ts";
import {
  toCliDiagnostic,
  type CliDiagnostic,
  type CliExitCode,
} from "./diagnostic.ts";

export interface CliErrorOutput {
  error: CliDiagnostic;
}

export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function outputText(text: string): void {
  console.log(text);
}

export function outputError(message: string): void {
  console.error(`error: ${message}`);
}

export function formatCliError(error: unknown, exitCode: CliExitCode): CliErrorOutput {
  return { error: toCliDiagnostic(error, exitCode) };
}

export function formatCliDiagnosticText(diagnostic: CliDiagnostic): string {
  const lines = [
    `error[${diagnostic.code}]: ${diagnostic.summary}`,
    `reason: ${diagnostic.reason}`,
    `next: ${diagnostic.suggestedAction}`,
  ];

  if (diagnostic.context && Object.keys(diagnostic.context).length > 0) {
    lines.push("context:");
    for (const [key, value] of Object.entries(diagnostic.context)) {
      lines.push(`  ${key}: ${String(value)}`);
    }
  }

  return lines.join("\n");
}

export function outputCliError(
  error: unknown,
  format: Format,
  exitCode: CliExitCode,
): void {
  const diagnostic = toCliDiagnostic(error, exitCode);
  if (format === "json") {
    console.error(JSON.stringify({ error: diagnostic }, null, 2));
    return;
  }

  console.error(formatCliDiagnosticText(diagnostic));
}

export function outputWarn(message: string): void {
  console.error(`warn: ${message}`);
}

export function outputInfo(message: string): void {
  console.error(message);
}

export function output<T>(data: T, format: Format, humanRenderer: (data: T) => string): void {
  if (format === "json") {
    outputJson(data);
  } else {
    outputText(humanRenderer(data));
  }
}

export function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );

  const sep = "  ";
  const headerLine = headers.map((h, i) => h.padEnd(widths[i]!)).join(sep);
  const divider = widths.map((w) => "─".repeat(w)).join(sep);
  const bodyLines = rows.map((row) =>
    row.map((cell, i) => cell.padEnd(widths[i]!)).join(sep),
  );

  return [headerLine, divider, ...bodyLines].join("\n");
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;

  return date.toISOString().slice(0, 10);
}
