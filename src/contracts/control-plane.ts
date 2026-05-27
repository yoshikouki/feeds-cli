import type { EventEnvelope, EventKind } from "./event.ts";
import type {
  HookId,
  HookRunId,
  IsoDateTimeString,
  JobId,
  JobRunId,
  PipelineId,
  WorkspaceId,
} from "./primitives.ts";

export type JobRunStatus = "running" | "success" | "error" | "skipped";
export type PersistedEventStatus = "pending" | "dispatched" | "failed";
export type HookRunStatus = "running" | "success" | "failed" | "skipped";

export interface JobRunRecord {
  readonly id: JobRunId;
  readonly workspaceId: WorkspaceId;
  readonly pipelineId: PipelineId;
  readonly jobId: JobId;
  readonly purpose: "scan" | "batch";
  readonly triggeredBy: "heartbeat" | "manual";
  readonly status: JobRunStatus;
  readonly startedAt: IsoDateTimeString;
  readonly finishedAt: IsoDateTimeString | null;
  readonly durationMs: number | null;
  readonly errorMessage: string | null;
}

export interface PersistedEventRecord<TKind extends EventKind = EventKind> {
  readonly event: EventEnvelope<TKind>;
  readonly status: PersistedEventStatus;
  readonly attemptCount: number;
  readonly lastDispatchAt: IsoDateTimeString | null;
  readonly lastError: string | null;
}

export interface HookRunRecord {
  readonly id: HookRunId;
  readonly workspaceId: WorkspaceId;
  readonly pipelineId: PipelineId;
  readonly eventId: string;
  readonly hookId: HookId;
  readonly hookKey: string;
  readonly attempt: number;
  readonly status: HookRunStatus;
  readonly startedAt: IsoDateTimeString;
  readonly finishedAt: IsoDateTimeString | null;
  readonly durationMs: number | null;
  readonly exitCode: number | null;
  readonly errorMessage: string | null;
}

export interface JobExecutionHealth {
  readonly jobId: JobId;
  readonly status: "never-ran" | "healthy" | "degraded" | "stale";
  readonly lastStartedAt: IsoDateTimeString | null;
  readonly lastFinishedAt: IsoDateTimeString | null;
  readonly lastSuccessAt: IsoDateTimeString | null;
  readonly lastErrorAt: IsoDateTimeString | null;
  readonly consecutiveFailures: number;
}
