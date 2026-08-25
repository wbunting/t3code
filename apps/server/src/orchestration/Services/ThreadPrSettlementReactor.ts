import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface ThreadPrSettlementReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class ThreadPrSettlementReactor extends Context.Service<
  ThreadPrSettlementReactor,
  ThreadPrSettlementReactorShape
>()("t3/orchestration/Services/ThreadPrSettlementReactor") {}
