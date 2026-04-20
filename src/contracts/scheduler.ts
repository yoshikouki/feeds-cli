import type {
  JobId,
  JsonObject,
  PipelineId,
  WorkspaceId,
} from "./primitives.ts";

export type ScheduleSpec =
  | {
      readonly kind: "interval";
      readonly every: string;
    }
  | {
      readonly kind: "cron";
      readonly expression: string;
      readonly timeZone?: string;
    };

export interface ScheduledJobSpec extends JsonObject {
  readonly id: JobId;
  readonly workspaceId: WorkspaceId;
  readonly pipelineId: PipelineId;
  readonly purpose: "scan" | "batch";
  readonly schedule: ScheduleSpec;
  readonly enabled: boolean;
}

export interface SchedulerPort {
  register(job: ScheduledJobSpec): Promise<void>;
  unregister(jobId: JobId): Promise<void>;
  get(jobId: JobId): Promise<ScheduledJobSpec | null>;
  list(workspaceId: WorkspaceId): Promise<readonly ScheduledJobSpec[]>;
}
