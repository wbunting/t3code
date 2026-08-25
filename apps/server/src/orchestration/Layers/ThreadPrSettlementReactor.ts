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
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { forkParked } from "../../serverActivation.ts";
import { normalizeSourceBranch } from "../../sourceControl/SourceControlProvider.ts";
import { SourceControlProviderRegistry } from "../../sourceControl/SourceControlProviderRegistry.ts";
import { VcsDriverRegistry } from "../../vcs/VcsDriverRegistry.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ThreadChangeRequestLinkStore,
  type ThreadChangeRequestLink,
} from "../Services/ThreadChangeRequestLinkStore.ts";
import {
  ThreadPrSettlementReactor,
  type ThreadPrSettlementReactorShape,
} from "../Services/ThreadPrSettlementReactor.ts";

const RECONCILE_INTERVAL = Duration.minutes(1);
const CHANGE_REQUEST_LOOKUP_TTL = Duration.minutes(2);
const CHANGE_REQUEST_LOOKUP_FAILURE_TTL = Duration.seconds(20);
const MAX_BRANCH_LOOKUPS_PER_RECONCILE = 20;

interface WorktreeIdentity {
  readonly branch: string | null;
  readonly headCommitSha: string | null;
}

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
  const vcsDrivers = yield* VcsDriverRegistry;
  const changeRequestLinks = yield* ThreadChangeRequestLinkStore;
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

  const linkedChangeRequestCache = yield* Cache.makeWith(
    (key: string) => {
      const [cwd = "", reference = ""] = key.split("\u0000");
      return sourceControlProviders
        .resolve({ cwd })
        .pipe(Effect.flatMap((provider) => provider.getChangeRequest({ cwd, reference })));
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

  const lookupLinkedChangeRequest = (cwd: string, reference: string) =>
    Cache.get(linkedChangeRequestCache, `${cwd}\u0000${reference}`).pipe(
      Effect.catch((error) =>
        Effect.logDebug("could not refresh linked pull request for automatic settlement", {
          cwdLength: cwd.length,
          referenceLength: reference.length,
          errorTag: error._tag,
        }).pipe(Effect.as(null)),
      ),
    );

  const readWorktreeIdentity = (cwd: string): Effect.Effect<WorktreeIdentity> =>
    vcsDrivers.resolve({ cwd }).pipe(
      Effect.flatMap(({ driver }) =>
        Effect.all({
          branch: driver.execute({
            operation: "ThreadPrSettlementReactor.currentBranch",
            cwd,
            args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
            allowNonZeroExit: true,
            timeoutMs: 5_000,
            maxOutputBytes: 4_096,
          }),
          head: driver.execute({
            operation: "ThreadPrSettlementReactor.headCommit",
            cwd,
            args: ["rev-parse", "--verify", "HEAD"],
            timeoutMs: 5_000,
            maxOutputBytes: 4_096,
          }),
        }),
      ),
      Effect.map(({ branch, head }) => ({
        branch: branch.exitCode === 0 ? branch.stdout.trim() || null : null,
        headCommitSha: head.stdout.trim() || null,
      })),
      Effect.catch((error) =>
        Effect.logDebug("could not read worktree identity for automatic settlement", {
          cwdLength: cwd.length,
          errorTag: error._tag,
        }).pipe(Effect.as({ branch: null, headCommitSha: null })),
      ),
    );

  const persistLink = Effect.fn("ThreadPrSettlementReactor.persistLink")(function* (
    thread: OrchestrationThreadShell,
    changeRequest: ChangeRequest,
    identity: WorktreeIdentity,
    existing: Option.Option<ThreadChangeRequestLink>,
  ) {
    const current = Option.getOrNull(existing);
    if (
      current?.provider === changeRequest.provider &&
      current.number === changeRequest.number &&
      current.url === changeRequest.url &&
      current.headRefName === changeRequest.headRefName &&
      current.headCommitSha === identity.headCommitSha
    ) {
      return;
    }
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* changeRequestLinks.upsert({
      threadId: thread.id,
      provider: changeRequest.provider,
      number: changeRequest.number,
      url: changeRequest.url,
      headRefName: changeRequest.headRefName,
      headCommitSha: identity.headCommitSha,
      linkedAt: current?.linkedAt ?? now,
      updatedAt: now,
    });
    yield* Effect.logInfo("linked thread to pull request", {
      threadId: thread.id,
      provider: changeRequest.provider,
      changeRequestNumber: changeRequest.number,
    });
  });

  const reconcileThread = Effect.fn("ThreadPrSettlementReactor.reconcileThread")(function* (
    thread: OrchestrationThreadShell,
    cwd: string,
  ) {
    const [identity, existingLink] = yield* Effect.all([
      readWorktreeIdentity(cwd),
      changeRequestLinks.get(thread.id),
    ]);
    if (Option.isSome(existingLink)) {
      const linkedChangeRequest = yield* lookupLinkedChangeRequest(cwd, existingLink.value.url);
      if (linkedChangeRequest?.state === "merged") {
        yield* settleMergedPullRequestSafely(thread, linkedChangeRequest);
      }
      return;
    }
    const branches = [identity.branch, thread.branch].filter(
      (branch, index, values): branch is string =>
        branch !== null &&
        values.findIndex((candidate) => candidate !== null && refsMatch(candidate, branch)) ===
          index,
    );
    let changeRequest: ChangeRequest | null = null;
    for (const branch of branches) {
      changeRequest = yield* lookupChangeRequest(cwd, branch);
      if (changeRequest !== null) break;
    }
    if (changeRequest !== null) {
      yield* persistLink(thread, changeRequest, identity, existingLink);
    }
    if (changeRequest?.state === "merged") {
      yield* settleMergedPullRequestSafely(thread, changeRequest);
    }
  });

  const reconcile = Effect.fn("ThreadPrSettlementReactor.reconcile")(function* () {
    const snapshot = yield* projectionSnapshotQuery.getShellSnapshot();
    const eligibleThreads = snapshot.threads.filter(
      (thread) =>
        thread.archivedAt === null &&
        thread.settledOverride === null &&
        thread.session?.status !== "starting" &&
        thread.session?.status !== "running" &&
        !thread.hasPendingApprovals &&
        !thread.hasPendingUserInput,
    );
    const candidates = eligibleThreads.flatMap((thread) => {
      const cwd = workspaceCwd(thread, snapshot.projects);
      return cwd === undefined ? [] : [{ thread, cwd }];
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

    yield* Effect.forEach(selected, ({ thread, cwd }) => reconcileThread(thread, cwd), {
      concurrency: 4,
      discard: true,
    });
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
