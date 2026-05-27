import { resolve } from "node:path";
import type {
  JobId,
  PipelineId,
  WorkspaceId,
} from "../contracts/primitives.ts";
import type { ScheduledJobSpec } from "../contracts/scheduler.ts";

const DEFAULT_SCAN_PIPELINE_SUFFIX = "workspace/default";
const DEFAULT_SCAN_JOB_SUFFIX = "scan";

export function workspaceIdFromBaseDir(baseDir: string): WorkspaceId {
  return resolve(baseDir) as WorkspaceId;
}

export function defaultPipelineId(workspaceId: WorkspaceId): PipelineId {
  return `${workspaceId}:${DEFAULT_SCAN_PIPELINE_SUFFIX}` as PipelineId;
}

export function defaultScanJobId(workspaceId: WorkspaceId): JobId {
  return `${workspaceId}:${DEFAULT_SCAN_JOB_SUFFIX}` as JobId;
}

export function defaultScheduledScanJob(
  baseDir: string,
  every: string,
): ScheduledJobSpec {
  const workspaceId = workspaceIdFromBaseDir(baseDir);
  const pipelineId = defaultPipelineId(workspaceId);

  return {
    id: defaultScanJobId(workspaceId),
    workspaceId,
    pipelineId,
    purpose: "scan",
    schedule: { kind: "interval", every },
    enabled: true,
  };
}
