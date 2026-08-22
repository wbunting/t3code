import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface ThreadMicrovmLifecycleReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class ThreadMicrovmLifecycleReactor extends Context.Service<
  ThreadMicrovmLifecycleReactor,
  ThreadMicrovmLifecycleReactorShape
>()("t3/orchestration/Services/ThreadMicrovmLifecycleReactor") {}
