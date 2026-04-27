import type {
  BatchId,
  EntryId,
  EventId,
  IsoDateTimeString,
  JsonObject,
  PipelineId,
  ScanRunId,
  SourceId,
  WorkspaceId,
} from "./primitives.ts";

export type EventKind =
  | "scan.started"
  | "entry.discovered"
  | "scan.completed"
  | "scan.failed"
  | "cycle.completed"
  | "batch.ready";

export interface ScanStartedPayload extends JsonObject {
  readonly scanRunId: ScanRunId;
  readonly sourceIds: readonly SourceId[];
  readonly feedId: string;
  readonly feedName: string;
  readonly startedAt: IsoDateTimeString;
}

export type ScanStartedEvent = EventEnvelope<"scan.started", ScanStartedPayload>;

export interface EventEnvelope<
  TKind extends EventKind = EventKind,
  TPayload extends JsonObject = JsonObject,
> {
  readonly id: EventId;
  readonly kind: TKind;
  readonly workspaceId: WorkspaceId;
  readonly pipelineId: PipelineId;
  readonly occurredAt: IsoDateTimeString;
  readonly payload: TPayload;
}

export interface EntryDiscoveredPayload extends JsonObject {
  readonly entryId: EntryId;
  readonly sourceId: SourceId;
  readonly scanRunId: ScanRunId;
  readonly discoveredAt: IsoDateTimeString;
  readonly feedId: string;
  readonly feedName: string;
  readonly title: string;
  readonly url: string;
  readonly publishedAt: IsoDateTimeString | null;
  readonly summary: string | null;
}

export type EntryDiscoveredEvent = EventEnvelope<
  "entry.discovered",
  EntryDiscoveredPayload
>;

export interface ScanCompletedPayload extends JsonObject {
  readonly scanRunId: ScanRunId;
  readonly sourceIds: readonly SourceId[];
  readonly feedId: string;
  readonly feedName: string;
  readonly scannedAt: IsoDateTimeString;
  readonly discoveredEntryCount: number;
  readonly articlesFound: number;
  readonly articlesInserted: number;
}

export type ScanCompletedEvent = EventEnvelope<
  "scan.completed",
  ScanCompletedPayload
>;

export interface ScanFailedPayload extends JsonObject {
  readonly scanRunId: ScanRunId;
  readonly sourceIds: readonly SourceId[];
  readonly feedId: string;
  readonly feedName: string;
  readonly failedAt: IsoDateTimeString;
  readonly errorMessage: string;
}

export type ScanFailedEvent = EventEnvelope<"scan.failed", ScanFailedPayload>;

export interface CycleCompletedPayload extends JsonObject {
  readonly scanRunId: ScanRunId;
  readonly completedAt: IsoDateTimeString;
  readonly totalFeeds: number;
  readonly totalNewEntries: number;
  readonly durationMs: number;
  readonly hadErrors: boolean;
}

export type CycleCompletedEvent = EventEnvelope<
  "cycle.completed",
  CycleCompletedPayload
>;

export interface BatchReadyPayload extends JsonObject {
  readonly batchId: BatchId;
  readonly entryIds: readonly EntryId[];
  readonly windowStartedAt: IsoDateTimeString;
  readonly windowEndedAt: IsoDateTimeString;
  readonly reason: "schedule" | "manual";
}

export type BatchReadyEvent = EventEnvelope<"batch.ready", BatchReadyPayload>;

export type FeedEvent =
  | ScanStartedEvent
  | EntryDiscoveredEvent
  | ScanCompletedEvent
  | ScanFailedEvent
  | CycleCompletedEvent
  | BatchReadyEvent;
