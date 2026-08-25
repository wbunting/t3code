import {
  CommandId,
  type ChangeRequest,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cache from "effect/Cache";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { forkParked } from "../../serverActivation.ts";
import { normalizeSourceBranch } from "../../sourceControl/SourceControlProvider.ts";
import { SourceControlProviderRegistry } from "../../sourceControl/SourceControlProviderRegistry.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ThreadPrSettlementReactor,
  type ThreadPrSettlementReactorShape,
} from "../Services/ThreadPrSettlementReactor.ts";

const RECONCILE_INTERVAL = Duration.minutes(1);
const CHANGE_REQUEST_LOOKUP_TTL = Duration.minutes(2);
const CHANGE_REQUEST_LOOKUP_FAILURE_TTL = Duration.seconds(20);
const MAX_BRANCH_LOOKUPS_PER_RECONCILE = 20;

function workspaceCwd(
  thread: Pick<OrchestrationThreadShell, "projectId" | "worktreePath">,
  projects: ReadonlyArray<OrchestrationProjectShell>,
): string | undefined {
  return resolveThreadWorkspaceCwd({ thread, projects });
}

function refsMatch(left: string, right: string): boolean {
  return normalizeSourceBranch(left) === normalizeSourceBranch(right);
}

function relevantChangeRequest(
  changeRequests: ReadonlyArray<ChangeRequest>,
  branch: string,
): ChangeRequest | null {
  const matching = changeRequests.filter((changeRequest) =>
    refsMatch(changeRequest.headRefName, branch),
  );
  return matching.find((changeRequest) => changeRequest.state === "open") ?? matching[0] ?? null;
}

export const makeThreadPrSettlementReactor = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const sourceControlProviders = yield* SourceControlProviderRegistry;
  const branchCursor = yield* Ref.make(0);

  const changeRequestCache = yield* Cache.makeWith(
    (key: string) => {
      const [cwd = "", branch = ""] = key.split("\u0000");
      return sourceControlProviders.resolve({ cwd }).pipe(
        Effect.flatMap((provider) =>
          provider.listChangeRequests({
            cwd,
            headSelector: branch,
            state: "all",
            limit: 20,
          }),
        ),
        Effect.map((changeRequests) => relevantChangeRequest(changeRequests, branch)),
      );
    },
    {
      capacity: 2_048,
      timeToLive: (exit) =>
        Exit.isSuccess(exit) ? CHANGE_REQUEST_LOOKUP_TTL : CHANGE_REQUEST_LOOKUP_FAILURE_TTL,
    },
  );

  const settleMergedPullRequest = Effect.fn("ThreadPrSettlementReactor.settleMergedPullRequest")(
    function* (thread: OrchestrationThreadShell, changeRequest: ChangeRequest) {
      const commandId = CommandId.make(
        `server:thread-pr-merged:${thread.id}:${changeRequest.provider}:${changeRequest.number}:${yield* crypto.randomUUIDv4}`,
      );
      yield* orchestrationEngine.dispatch({
        type: "thread.settle",
        commandId,
        threadId: thread.id,
      });
      yield* Effect.logInfo("settled thread after merged pull request", {
        threadId: thread.id,
        provider: changeRequest.provider,
        changeRequestNumber: changeRequest.number,
      });
    },
  );

  const settleMergedPullRequestSafely = (
    thread: OrchestrationThreadShell,
    changeRequest: ChangeRequest,
  ) =>
    settleMergedPullRequest(thread, changeRequest).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
        return Effect.logDebug("merged pull request settlement deferred after state changed", {
          threadId: thread.id,
          provider: changeRequest.provider,
          changeRequestNumber: changeRequest.number,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const lookupChangeRequest = (cwd: string, branch: string) =>
    Cache.get(changeRequestCache, `${cwd}\u0000${branch}`).pipe(
      Effect.catch((error) =>
        Effect.logDebug("could not read pull request state for automatic settlement", {
          cwdLength: cwd.length,
          branch,
          errorTag: error._tag,
        }).pipe(Effect.as(null)),
      ),
    );

  const reconcile = Effect.fn("ThreadPrSettlementReactor.reconcile")(function* () {
    const snapshot = yield* projectionSnapshotQuery.getShellSnapshot();
    const eligibleThreads = snapshot.threads.filter(
      (thread) =>
        thread.archivedAt === null &&
        thread.settledOverride === null &&
        thread.branch !== null &&
        thread.session?.status !== "starting" &&
        thread.session?.status !== "running" &&
        !thread.hasPendingApprovals &&
        !thread.hasPendingUserInput,
    );
    const candidates = eligibleThreads.flatMap((thread) => {
      const cwd = workspaceCwd(thread, snapshot.projects);
      const branch = thread.branch;
      return cwd === undefined || branch === null ? [] : [{ thread, cwd, branch }];
    });
    const start = candidates.length === 0 ? 0 : (yield* Ref.get(branchCursor)) % candidates.length;
    const count = Math.min(MAX_BRANCH_LOOKUPS_PER_RECONCILE, candidates.length);
    const selected = Array.from(
      { length: count },
      (_, offset) => candidates[(start + offset) % candidates.length]!,
    );
    if (candidates.length > 0) {
      yield* Ref.set(branchCursor, (start + count) % candidates.length);
    }

    yield* Effect.forEach(
      selected,
      ({ thread, cwd, branch }) =>
        lookupChangeRequest(cwd, branch).pipe(
          Effect.flatMap((changeRequest) =>
            changeRequest?.state === "merged"
              ? settleMergedPullRequestSafely(thread, changeRequest)
              : Effect.void,
          ),
        ),
      { concurrency: 4, discard: true },
    );
  });

  const reconcileSafely = reconcile().pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
      return Effect.logWarning("pull request settlement reactor failed to reconcile", {
        cause: Cause.pretty(cause),
      });
    }),
  );
  const worker = yield* makeDrainableWorker((_input: void) => reconcileSafely);

  const start: ThreadPrSettlementReactorShape["start"] = Effect.fn(
    "ThreadPrSettlementReactor.start",
  )(function* () {
    yield* worker.enqueue(undefined);
    yield* forkParked(
      Effect.sleep(RECONCILE_INTERVAL).pipe(
        Effect.andThen(worker.enqueue(undefined)),
        Effect.forever,
      ),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies ThreadPrSettlementReactorShape;
});

export const ThreadPrSettlementReactorLive = Layer.effect(
  ThreadPrSettlementReactor,
  makeThreadPrSettlementReactor,
);
