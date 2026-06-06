import { outputWarn } from "../cli/output.ts";
import type { PersistedEventRecord } from "../contracts/control-plane.ts";
import type {
  CycleCompletedPayload,
  EntryDiscoveredPayload,
  EventEnvelope,
  EventKind,
  ScanCompletedPayload,
  ScanFailedPayload,
  ScanStartedPayload,
} from "../contracts/event.ts";
import type { FeedDatabase } from "../db/index.ts";
import { shouldDispatchEntryHooks } from "../hooks/filter.ts";
import type { ResolvedPaths } from "../paths.ts";
import type { SourceHooksConfig } from "../types.ts";
import {
  discoverHooks,
  executeHooks,
  type HookContext,
} from "../cron/hooks.ts";
import { workspaceIdFromBaseDir } from "./identity.ts";

export type EventDispatchPaths =
  & Pick<ResolvedPaths, "base" | "hooksDir" | "hooksEnabled">
  & {
    sourceHookConfigs?: ReadonlyMap<string, SourceHooksConfig>;
  };

export async function dispatchPendingEvents(
  db: FeedDatabase,
  paths: EventDispatchPaths,
): Promise<void> {
  const workspaceId = workspaceIdFromBaseDir(paths.base);
  const pendingEvents = db.listDispatchableEvents(workspaceId);

  for (const record of pendingEvents) {
    const hookContext = hookContextForEvent(record.event);
    if (!paths.hooksEnabled) {
      db.markEventDispatched(record.event.id);
      continue;
    }

    if (!shouldDispatchHooksForEvent(record.event, paths.sourceHookConfigs)) {
      db.markEventDispatched(record.event.id);
      continue;
    }

    const hooks = await discoverHooks(paths.hooksDir, hookContext.event);
    const pendingHooks = hooks.filter((hookPath) => !db.hasSuccessfulHookRun(record.event.id, hookPath));
    if (pendingHooks.length === 0) {
      db.markEventDispatched(record.event.id);
      continue;
    }

    const startedAt = new Date().toISOString();
    const hookResults = await executeHooks(pendingHooks, hookContext);
    const finishedAt = new Date().toISOString();

    if (hookResults.length === 0) {
      db.markEventDispatched(record.event.id);
      continue;
    }

    let hasFailures = false;
    let errorMessage: string | null = null;

    for (const hookResult of hookResults) {
      const attempt = db.nextHookAttempt(record.event.id, hookResult.hookPath);
      const status = hookResult.exitCode === 0 && hookResult.error === null
        ? "success"
        : "failed";
      if (status === "failed") {
        hasFailures = true;
        errorMessage = hookResult.error
          ?? `Hook exited with code ${hookResult.exitCode}`;
      }

      db.recordHookRun({
        eventId: record.event.id,
        workspaceId: record.event.workspaceId,
        pipelineId: record.event.pipelineId,
        hookKey: hookResult.hookPath,
        attempt,
        status,
        startedAt,
        finishedAt,
        exitCode: hookResult.exitCode,
        errorMessage: hookResult.error,
      });
    }

    if (hasFailures) {
      const message = errorMessage ?? `Hook dispatch failed for ${record.event.kind}`;
      outputWarn(message);
      db.markEventFailed(record.event.id, message);
      continue;
    }

    db.markEventDispatched(record.event.id);
  }
}

function shouldDispatchHooksForEvent(
  event: EventEnvelope,
  sourceHookConfigs: ReadonlyMap<string, SourceHooksConfig> | undefined,
): boolean {
  if (event.kind !== "entry.discovered") {
    return true;
  }

  const payload = event.payload as EntryDiscoveredPayload;
  return shouldDispatchEntryHooks(
    payload,
    sourceHookConfigs?.get(payload.sourceId),
  );
}

function hookContextForEvent(event: EventEnvelope): HookContext {
  switch (event.kind) {
    case "scan.started":
      return scanStartedHookContext(event as EventEnvelope<"scan.started", ScanStartedPayload>);
    case "entry.discovered":
      return entryDiscoveredHookContext(
        event as EventEnvelope<"entry.discovered", EntryDiscoveredPayload>,
      );
    case "scan.completed":
      return scanCompletedHookContext(
        event as EventEnvelope<"scan.completed", ScanCompletedPayload>,
      );
    case "scan.failed":
      return scanFailedHookContext(event as EventEnvelope<"scan.failed", ScanFailedPayload>);
    case "cycle.completed":
      return cycleCompletedHookContext(
        event as EventEnvelope<"cycle.completed", CycleCompletedPayload>,
      );
    default:
      return { event: event.kind, env: {} };
  }
}

function scanStartedHookContext(
  event: EventEnvelope<"scan.started", ScanStartedPayload>,
): HookContext {
  return {
    event: "scan-start",
    env: {
      FEEDS_FEED_NAME: event.payload.feedName,
      FEEDS_FEED_ID: event.payload.feedId,
    },
  };
}

function entryDiscoveredHookContext(
  event: EventEnvelope<"entry.discovered", EntryDiscoveredPayload>,
): HookContext {
  const article = {
    id: event.payload.entryId,
    title: event.payload.title,
    url: event.payload.url,
    publishedAt: event.payload.publishedAt,
    feedName: event.payload.feedName,
    summary: event.payload.summary,
  };
  const json = JSON.stringify([article]);
  return {
    event: "new-articles",
    env: {
      FEEDS_FEED_NAME: event.payload.feedName,
      FEEDS_FEED_ID: event.payload.feedId,
      FEEDS_NEW_ARTICLES_JSON: json,
    },
    stdin: json,
  };
}

function scanCompletedHookContext(
  event: EventEnvelope<"scan.completed", ScanCompletedPayload>,
): HookContext {
  return {
    event: "scan-complete",
    env: {
      FEEDS_FEED_NAME: event.payload.feedName,
      FEEDS_FEED_ID: event.payload.feedId,
      FEEDS_ARTICLE_COUNT: String(event.payload.articlesFound),
      FEEDS_NEW_ARTICLE_COUNT: String(event.payload.articlesInserted),
    },
  };
}

function scanFailedHookContext(
  event: EventEnvelope<"scan.failed", ScanFailedPayload>,
): HookContext {
  return {
    event: "scan-error",
    env: {
      FEEDS_FEED_NAME: event.payload.feedName,
      FEEDS_FEED_ID: event.payload.feedId,
      FEEDS_ERROR_MESSAGE: event.payload.errorMessage,
    },
  };
}

function cycleCompletedHookContext(
  event: EventEnvelope<"cycle.completed", CycleCompletedPayload>,
): HookContext {
  return {
    event: "cycle-complete",
    env: {
      FEEDS_TOTAL_FEEDS: String(event.payload.totalFeeds),
      FEEDS_TOTAL_NEW_ARTICLES: String(event.payload.totalNewEntries),
      FEEDS_CYCLE_DURATION_MS: String(event.payload.durationMs),
    },
  };
}
