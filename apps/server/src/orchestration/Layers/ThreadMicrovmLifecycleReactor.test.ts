import type { OrchestrationEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vite-plus/test";

import {
  ThreadMicrovmLifecycle,
  type ThreadMicrovmLifecycleInput,
} from "../../hydra/ThreadMicrovmLifecycle.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ThreadMicrovmLifecycleReactor } from "../Services/ThreadMicrovmLifecycleReactor.ts";
import { ThreadMicrovmLifecycleReactorLive } from "./ThreadMicrovmLifecycleReactor.ts";

const event = (
  sequence: number,
  type: OrchestrationEvent["type"],
  payload: Record<string, unknown>,
): OrchestrationEvent =>
  ({
    sequence,
    eventId: `event-${sequence}`,
    type,
    aggregateKind: "thread",
    aggregateId: "thread-1",
    occurredAt: "2026-08-22T00:00:00.000Z",
    commandId: `command-${sequence}`,
    causationEventId: null,
    correlationId: null,
    actorKind: "user",
    payload,
    metadata: {},
  }) as unknown as OrchestrationEvent;

describe("ThreadMicrovmLifecycleReactor", () => {
  it("replays settled ownership as one released Hydra intent", async () => {
    const history = [
      event(1, "thread.created", {
        threadId: "thread-1",
        projectId: "project-1",
        title: "Thread",
        modelSelection: { provider: "pi", model: "default" },
        runtimeMode: "web",
        interactionMode: "default",
        branch: "t3code/thread-1",
        worktreePath: "/worktrees/thread-1",
        createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-22T00:00:00.000Z",
      }),
      event(2, "thread.settled", {
        threadId: "thread-1",
        settledAt: "2026-08-22T00:01:00.000Z",
        updatedAt: "2026-08-22T00:01:00.000Z",
      }),
    ];
    const calls: ThreadMicrovmLifecycleInput[] = [];
    const live = await Effect.runPromise(PubSub.unbounded<OrchestrationEvent>());
    const runtime = ManagedRuntime.make(
      ThreadMicrovmLifecycleReactorLive.pipe(
        Layer.provide(
          Layer.succeed(OrchestrationEngineService, {
            readEvents: () => Stream.fromIterable(history),
            dispatch: () => Effect.die("unused"),
            get streamDomainEvents() {
              return Stream.fromPubSub(live);
            },
            latestSequence: Effect.succeed(2),
          }),
        ),
        Layer.provide(
          Layer.succeed(ThreadMicrovmLifecycle, {
            enabled: true,
            sync: (input) =>
              Effect.sync(() => {
                calls.push(input);
              }),
          }),
        ),
      ),
    );
    const scope = await Effect.runPromise(Scope.make("sequential"));
    try {
      const reactor = await runtime.runPromise(Effect.service(ThreadMicrovmLifecycleReactor));
      await Effect.runPromise(reactor.start().pipe(Scope.provide(scope)));
      await runtime.runPromise(reactor.drain);
      expect(calls).toEqual([
        {
          threadId: "thread-1",
          worktreePath: "/worktrees/thread-1",
          desiredState: "released",
        },
      ]);
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      await runtime.dispose();
    }
  });

  it("synchronizes only the latest thread that owns a reused worktree", async () => {
    const history = [
      event(1, "thread.created", {
        threadId: "thread-old",
        projectId: "project-1",
        title: "Old thread",
        modelSelection: { provider: "pi", model: "default" },
        runtimeMode: "web",
        interactionMode: "default",
        branch: "t3code/shared",
        worktreePath: "/worktrees/shared",
        createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-22T00:00:00.000Z",
      }),
      event(2, "thread.created", {
        threadId: "thread-current",
        projectId: "project-1",
        title: "Current thread",
        modelSelection: { provider: "pi", model: "default" },
        runtimeMode: "web",
        interactionMode: "default",
        branch: "t3code/shared",
        worktreePath: "/worktrees/shared",
        createdAt: "2026-08-22T00:01:00.000Z",
        updatedAt: "2026-08-22T00:01:00.000Z",
      }),
      event(3, "thread.settled", {
        threadId: "thread-old",
        settledAt: "2026-08-22T00:02:00.000Z",
        updatedAt: "2026-08-22T00:02:00.000Z",
      }),
      event(4, "thread.settled", {
        threadId: "thread-current",
        settledAt: "2026-08-22T00:03:00.000Z",
        updatedAt: "2026-08-22T00:03:00.000Z",
      }),
    ];
    const calls: ThreadMicrovmLifecycleInput[] = [];
    const live = await Effect.runPromise(PubSub.unbounded<OrchestrationEvent>());
    const runtime = ManagedRuntime.make(
      ThreadMicrovmLifecycleReactorLive.pipe(
        Layer.provide(
          Layer.succeed(OrchestrationEngineService, {
            readEvents: () => Stream.fromIterable(history),
            dispatch: () => Effect.die("unused"),
            get streamDomainEvents() {
              return Stream.fromPubSub(live);
            },
            latestSequence: Effect.succeed(4),
          }),
        ),
        Layer.provide(
          Layer.succeed(ThreadMicrovmLifecycle, {
            enabled: true,
            sync: (input) =>
              Effect.sync(() => {
                calls.push(input);
              }),
          }),
        ),
      ),
    );
    const scope = await Effect.runPromise(Scope.make("sequential"));
    try {
      const reactor = await runtime.runPromise(Effect.service(ThreadMicrovmLifecycleReactor));
      await Effect.runPromise(reactor.start().pipe(Scope.provide(scope)));
      await runtime.runPromise(reactor.drain);
      expect(calls).toEqual([
        {
          threadId: "thread-current",
          worktreePath: "/worktrees/shared",
          desiredState: "released",
        },
      ]);
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      await runtime.dispose();
    }
  });
});
