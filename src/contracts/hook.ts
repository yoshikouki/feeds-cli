import type { EventEnvelope, EventKind } from "./event.ts";
import type {
  HookId,
  IsoDateTimeString,
  JsonObject,
  PipelineId,
  StringMap,
  WorkspaceId,
} from "./primitives.ts";

export interface HookCondition extends JsonObject {
  readonly pipelineIds?: readonly PipelineId[];
  readonly sourceTags?: readonly string[];
}

export interface HookTrigger {
  readonly eventKinds: readonly EventKind[];
  readonly when?: HookCondition;
}

export interface HookSpec {
  readonly id: HookId;
  readonly name: string;
  readonly kind: "command";
  readonly command: string;
  readonly args?: readonly string[];
  readonly workingDirectory?: string;
  readonly env?: StringMap;
  readonly stdinMode?: "none" | "event-json";
  readonly timeoutMs?: number;
}

export interface HookExecutionRequest {
  readonly workspaceId: WorkspaceId;
  readonly hook: HookSpec;
  readonly event: EventEnvelope;
  readonly attempt: number;
  readonly dispatchedAt: IsoDateTimeString;
}

export interface HookExecutionResult extends JsonObject {
  readonly status: "success" | "failed" | "retryable" | "skipped";
  readonly completedAt: IsoDateTimeString;
  readonly exitCode: number | null;
  readonly errorMessage: string | null;
  readonly outputSummary?: string | null;
}

export interface HookPort {
  execute(request: HookExecutionRequest): Promise<HookExecutionResult>;
}
