import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

const CRON_JOB_PREFIX = "feeds-cli";
const WORKSPACE_SLUG_FALLBACK = "workspace";
const WORKSPACE_SLUG_MAX_LENGTH = 32;
const JOB_HASH_LENGTH = 12;

export function normalizeCronBaseDir(baseDir: string): string {
  return resolve(baseDir);
}

export function cronJobTitle(baseDir: string): string {
  const normalizedBaseDir = normalizeCronBaseDir(baseDir);
  const slug = cronJobSlug(normalizedBaseDir);
  const hash = createHash("sha256")
    .update(normalizedBaseDir)
    .digest("hex")
    .slice(0, JOB_HASH_LENGTH);

  return `${CRON_JOB_PREFIX}-${slug}-${hash}`;
}

export function extractCronJobTitleFromArgv(argv: string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (token.startsWith("--cron-title=")) {
      return token.slice("--cron-title=".length);
    }

    if (token === "--cron-title") {
      return argv[index + 1] ?? null;
    }
  }

  return null;
}

export function currentCronJobTitle(
  controller?: Bun.CronController,
  argv: string[] = Bun.argv,
): string {
  const controllerTitle = cronControllerTitle(controller);
  if (controllerTitle) {
    return controllerTitle;
  }

  const argvTitle = extractCronJobTitleFromArgv(argv);
  if (argvTitle) {
    return argvTitle;
  }

  throw new Error("Cron job title is missing");
}

function cronJobSlug(baseDir: string): string {
  const slug = basename(baseDir)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, WORKSPACE_SLUG_MAX_LENGTH);

  return slug || WORKSPACE_SLUG_FALLBACK;
}

function cronControllerTitle(controller?: Bun.CronController): string | null {
  if (!controller || typeof controller !== "object") {
    return null;
  }

  const maybeTitle = (controller as { title?: unknown; name?: unknown }).title
    ?? (controller as { title?: unknown; name?: unknown }).name;

  return typeof maybeTitle === "string" && maybeTitle.length > 0
    ? maybeTitle
    : null;
}
