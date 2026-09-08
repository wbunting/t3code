import * as Schema from "effect/Schema";
import { ThreadId } from "./baseSchemas.ts";

export const ThreadVmInput = Schema.Struct({ threadId: ThreadId });
export const ThreadVmStatus = Schema.Struct({
  state: Schema.Literals(["none", "loading", "live", "failed", "stopped", "unknown"]),
  detail: Schema.String,
  instanceId: Schema.optional(Schema.String),
  address: Schema.optional(Schema.String),
});
export type ThreadVmStatus = typeof ThreadVmStatus.Type;
export const ThreadVmConsole = Schema.Struct({ path: Schema.String });
export class ThreadVmError extends Schema.TaggedError<ThreadVmError>()("ThreadVmError", {
  message: Schema.String,
}) {}
