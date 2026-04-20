export type Brand<TValue, TBrand extends string> = TValue & {
  readonly __brand: TBrand;
};

export type WorkspaceId = Brand<string, "WorkspaceId">;
export type PipelineId = Brand<string, "PipelineId">;
export type SourceId = Brand<string, "SourceId">;
export type EntryId = Brand<string, "EntryId">;
export type EventId = Brand<string, "EventId">;
export type HookId = Brand<string, "HookId">;
export type BatchId = Brand<string, "BatchId">;
export type JobId = Brand<string, "JobId">;
export type ScanRunId = Brand<string, "ScanRunId">;

export type IsoDateTimeString = Brand<string, "IsoDateTimeString">;

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue | undefined };

export type JsonObject = { readonly [key: string]: JsonValue | undefined };

export type StringMap = Readonly<Record<string, string>>;

export type Result<TValue, TError> =
  | {
      readonly ok: true;
      readonly value: TValue;
    }
  | {
      readonly ok: false;
      readonly error: TError;
    };
