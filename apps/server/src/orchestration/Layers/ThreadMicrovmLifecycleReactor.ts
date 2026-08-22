import type { OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import { ThreadMicrovmLifecycle } from "../../hydra/ThreadMicrovmLifecycle.ts";
import { forkParked } from "../../serverActivation.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ThreadMicrovmLifecycleReactor,
  type ThreadMicrovmLifecycleReactorShape,
} from "../Services/ThreadMicrovmLifecycleReactor.ts";

type BindingIntent = {
  readonly threadId: string;
  readonly worktreePath: string;
  readonly desiredState: "active" | "released";
};

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const lifecycle = yield* ThreadMicrovmLifecycle;
  const bindings = new Map<string, BindingIntent>();
  const worktreeOwners = new Map<string, string>();

  const claimWorktree = (intent: BindingIntent): BindingIntent => {
    const prior = bindings.get(intent.threadId);
    if (prior && prior.worktreePath !== intent.worktreePath) {
      if (worktreeOwners.get(prior.worktreePath) === intent.threadId) {
        worktreeOwners.delete(prior.worktreePath);
      }
    }
    const priorOwner = worktreeOwners.get(intent.worktreePath);
    if (priorOwner && priorOwner !== intent.threadId) {
      bindings.delete(priorOwner);
    }
    worktreeOwners.set(intent.worktreePath, intent.threadId);
    bindings.set(intent.threadId, intent);
    return intent;
  };

  const intentFromEvent = (event: OrchestrationEvent): BindingIntent | undefined => {
    switch (event.type) {
      case "thread.created": {
        if (!event.payload.worktreePath) return undefined;
        const intent = {
          threadId: event.payload.threadId,
          worktreePath: event.payload.worktreePath,
          desiredState: "active" as const,
        };
        return claimWorktree(intent);
      }
      case "thread.meta-updated": {
        if (!event.payload.worktreePath) return undefined;
        const current = bindings.get(event.payload.threadId);
        const intent = {
          threadId: event.payload.threadId,
          worktreePath: event.payload.worktreePath,
          desiredState: current?.desiredState ?? ("active" as const),
        };
        return claimWorktree(intent);
      }
      case "thread.settled": {
        const current = bindings.get(event.payload.threadId);
        if (!current) return undefined;
        if (worktreeOwners.get(current.worktreePath) !== event.payload.threadId) return undefined;
        const intent = { ...current, desiredState: "released" as const };
        bindings.set(intent.threadId, intent);
        return intent;
      }
      default:
        return undefined;
    }
  };

  const syncIntent = Effect.fn("ThreadMicrovmLifecycleReactor.syncIntent")(function* (
    intent: BindingIntent,
  ) {
    yield* lifecycle.sync(intent).pipe(
      Effect.retry({
        schedule: Schedule.exponential("250 millis").pipe(
          Schedule.modifyDelay(({ duration }) =>
            Effect.succeed(Duration.min(duration, Duration.seconds(30))),
          ),
          Schedule.upTo({ duration: "10 minutes" }),
        ),
      }),
    );
  });

  const syncIntentSafely = (intent: BindingIntent) =>
    syncIntent(intent).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
        return Effect.logWarning("failed to synchronize T3 thread microVM lifecycle", {
          threadId: intent.threadId,
          worktreePath: intent.worktreePath,
          desiredState: intent.desiredState,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(syncIntentSafely);

  const enqueueEvent = (event: OrchestrationEvent) => {
    const intent = intentFromEvent(event);
    return intent ? worker.enqueue(intent) : Effect.void;
  };

  const start: ThreadMicrovmLifecycleReactorShape["start"] = Effect.fn("start")(function* () {
    if (!lifecycle.enabled) return;

    // Subscribe before replay so an event committed during startup cannot
    // fall between the historical scan and the live stream. Duplicate
    // intents are safe because Hydra's release transition is monotonic.
    yield* forkParked(Stream.runForEach(orchestrationEngine.streamDomainEvents, enqueueEvent));

    yield* Stream.runForEach(orchestrationEngine.readEvents(0, Number.MAX_SAFE_INTEGER), (event) =>
      Effect.sync(() => intentFromEvent(event)),
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("failed to replay T3 thread microVM lifecycle", {
          cause: Cause.pretty(cause),
        }),
      ),
    );
    yield* Effect.forEach(bindings.values(), worker.enqueue, { discard: true });
  });

  return {
    start,
    drain: worker.drain,
  } satisfies ThreadMicrovmLifecycleReactorShape;
});

export const ThreadMicrovmLifecycleReactorLive = Layer.effect(ThreadMicrovmLifecycleReactor, make);
