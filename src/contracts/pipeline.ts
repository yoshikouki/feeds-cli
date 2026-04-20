import type { HookId, SourceId, StringMap, PipelineId } from "./primitives.ts";
import type { HookTrigger } from "./hook.ts";
import type { ScheduleSpec } from "./scheduler.ts";

export interface SourceRef {
  readonly sourceId: SourceId;
}

export interface ScanPolicy {
  readonly schedule: ScheduleSpec;
  readonly timeoutMs?: number;
}

export interface BatchPolicy {
  readonly schedule: ScheduleSpec;
  readonly maxEntries?: number;
}

export interface PipelineHookBinding {
  readonly hookId: HookId;
  readonly trigger: HookTrigger;
  readonly env?: StringMap;
}

export interface PipelineSpec {
  readonly id: PipelineId;
  readonly name: string;
  readonly enabled: boolean;
  readonly sources: readonly SourceRef[];
  readonly scan: ScanPolicy;
  readonly batching?: BatchPolicy | null;
  readonly hooks: readonly PipelineHookBinding[];
}
