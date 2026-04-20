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
  | "entry.discovered"
  | "scan.completed"
  | "scan.failed"
  | "batch.ready";

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
  readonly title: string;
  readonly url: string;
  readonly publishedAt: IsoDateTimeString | null;
}

export type EntryDiscoveredEvent = EventEnvelope<
  "entry.discovered",
  EntryDiscoveredPayload
>;

export interface ScanCompletedPayload extends JsonObject {
  readonly scanRunId: ScanRunId;
  readonly sourceIds: readonly SourceId[];
  readonly scannedAt: IsoDateTimeString;
  readonly discoveredEntryCount: number;
}

export type ScanCompletedEvent = EventEnvelope<
  "scan.completed",
  ScanCompletedPayload
>;

export interface ScanFailedPayload extends JsonObject {
  readonly scanRunId: ScanRunId;
  readonly sourceIds: readonly SourceId[];
  readonly failedAt: IsoDateTimeString;
  readonly errorMessage: string;
}

export type ScanFailedEvent = EventEnvelope<"scan.failed", ScanFailedPayload>;

export interface BatchReadyPayload extends JsonObject {
  readonly batchId: BatchId;
  readonly entryIds: readonly EntryId[];
  readonly windowStartedAt: IsoDateTimeString;
  readonly windowEndedAt: IsoDateTimeString;
  readonly reason: "schedule" | "manual";
}

export type BatchReadyEvent = EventEnvelope<"batch.ready", BatchReadyPayload>;

export type FeedEvent =
  | EntryDiscoveredEvent
  | ScanCompletedEvent
  | ScanFailedEvent
  | BatchReadyEvent;
