import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ChangeRequest,
  type OrchestrationCommand,
  type OrchestrationProjectShell,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { describe } from "vite-plus/test";

import * as SourceControlProvider from "../../sourceControl/SourceControlProvider.ts";
import { SourceControlProviderRegistry } from "../../sourceControl/SourceControlProviderRegistry.ts";
import { VcsDriverRegistry } from "../../vcs/VcsDriverRegistry.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../Services/ProjectionSnapshotQuery.ts";
import {
  ThreadChangeRequestLinkStore,
  type ThreadChangeRequestLink,
} from "../Services/ThreadChangeRequestLinkStore.ts";
import { makeThreadPrSettlementReactor } from "./ThreadPrSettlementReactor.ts";

const projectId = ProjectId.make("project-1");
const project: OrchestrationProjectShell = {
  id: projectId,
  title: "Project",
  workspaceRoot: "/repo",
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

function makeThread(input: {
  readonly id: string;
  readonly branch: string;
  readonly settledOverride?: "settled" | "active" | null;
  readonly sessionStatus?: "running" | "stopped";
}): OrchestrationThreadShell {
  const id = ThreadId.make(input.id);
  return {
    id,
    projectId,
    title: input.id,
    modelSelection: { instanceId: ProviderInstanceId.make("pi"), model: "default" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: input.branch,
    worktreePath: `/worktrees/${input.id}`,
    latestTurn: null,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    archivedAt: null,
    settledOverride: input.settledOverride ?? null,
    settledAt: null,
    session:
      input.sessionStatus === undefined
        ? null
        : {
            threadId: id,
            status: input.sessionStatus,
            providerName: "pi",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: "2026-08-25T00:00:00.000Z",
          },
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

function changeRequest(
  headRefName: string,
  state: ChangeRequest["state"],
  number = 1,
): ChangeRequest {
  return {
    provider: "github",
    number,
    title: headRefName,
    url: `https://example.test/pull/${number}`,
    baseRefName: "main",
    headRefName,
    state,
    updatedAt: Option.none(),
  };
}

describe("ThreadPrSettlementReactor", () => {
  it.effect(
    "persists merged PR settlement while leaving open, pinned, and running threads active",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const merged = makeThread({ id: "merged", branch: "feature/merged" });
          const open = makeThread({ id: "open", branch: "feature/open" });
          const pinned = makeThread({
            id: "pinned",
            branch: "feature/pinned",
            settledOverride: "active",
          });
          const running = makeThread({
            id: "running",
            branch: "feature/running",
            sessionStatus: "running",
          });
          const reusedBranch = makeThread({ id: "reused", branch: "feature/reused" });
          const snapshot = {
            snapshotSequence: 1,
            projects: [project],
            threads: [merged, open, pinned, running, reusedBranch],
            updatedAt: "2026-08-25T00:00:00.000Z",
          } satisfies OrchestrationShellSnapshot;
          const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);

          const provider = {
            kind: "github",
            listChangeRequests: (input: { readonly headSelector: string }) =>
              Effect.succeed(
                input.headSelector === merged.branch
                  ? [changeRequest(input.headSelector, "merged", 42)]
                  : input.headSelector === open.branch
                    ? [changeRequest(input.headSelector, "open")]
                    : input.headSelector === reusedBranch.branch
                      ? [
                          changeRequest(input.headSelector, "merged", 40),
                          changeRequest(input.headSelector, "open", 41),
                        ]
                      : [changeRequest(input.headSelector, "merged")],
              ),
          } as unknown as SourceControlProvider.SourceControlProvider["Service"];
          const threadsByCwd = new Map(
            snapshot.threads.map((thread) => [thread.worktreePath, thread] as const),
          );
          const dependencies = Layer.mergeAll(
            Layer.succeed(OrchestrationEngineService, {
              readEvents: () => Stream.empty,
              dispatch: (command) =>
                Ref.update(dispatched, (commands) => [...commands, command]).pipe(
                  Effect.as({ sequence: 1 }),
                ),
              streamDomainEvents: Stream.empty,
              latestSequence: Effect.succeed(0),
            } satisfies OrchestrationEngineShape),
            Layer.succeed(ProjectionSnapshotQuery, {
              getShellSnapshot: () => Effect.succeed(snapshot),
            } as unknown as ProjectionSnapshotQueryShape),
            Layer.succeed(SourceControlProviderRegistry, {
              resolve: () => Effect.succeed(provider),
            } as unknown as SourceControlProviderRegistry["Service"]),
            Layer.succeed(VcsDriverRegistry, {
              resolve: ({ cwd }: { readonly cwd: string }) =>
                Effect.succeed({
                  kind: "git",
                  repository: {},
                  driver: {
                    execute: ({ args }: { readonly args: ReadonlyArray<string> }) =>
                      Effect.succeed({
                        exitCode: 0,
                        stdout:
                          args[0] === "symbolic-ref"
                            ? `${threadsByCwd.get(cwd)?.branch ?? ""}\n`
                            : "abc123\n",
                        stderr: "",
                        stdoutTruncated: false,
                        stderrTruncated: false,
                      }),
                  },
                }),
            } as unknown as VcsDriverRegistry["Service"]),
            Layer.succeed(ThreadChangeRequestLinkStore, {
              get: () => Effect.succeed(Option.none()),
              upsert: () => Effect.void,
            }),
            NodeServices.layer,
          );
          const reactor = yield* makeThreadPrSettlementReactor.pipe(Effect.provide(dependencies));
          yield* reactor.start();
          yield* reactor.drain;

          const commands = yield* Ref.get(dispatched);
          expect(commands).toHaveLength(1);
          expect(commands[0]).toMatchObject({
            type: "thread.settle",
            threadId: merged.id,
          });
          expect(commands[0]?.commandId).toMatch(
            /^server:thread-pr-merged:merged:github:42:[0-9a-f-]+$/u,
          );
        }),
      ),
  );

  it.effect("discovers a renamed worktree branch and persists the stable PR identity", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const thread = makeThread({ id: "renamed", branch: "t3code/stale" });
        const snapshot = {
          snapshotSequence: 1,
          projects: [project],
          threads: [thread],
          updatedAt: "2026-08-25T00:00:00.000Z",
        } satisfies OrchestrationShellSnapshot;
        const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
        const links = yield* Ref.make<ReadonlyArray<ThreadChangeRequestLink>>([]);
        const provider = {
          kind: "github",
          listChangeRequests: ({ headSelector }: { readonly headSelector: string }) =>
            Effect.succeed(
              headSelector === "feature/renamed"
                ? [changeRequest("feature/renamed", "merged", 54)]
                : [],
            ),
        } as unknown as SourceControlProvider.SourceControlProvider["Service"];
        const dependencies = Layer.mergeAll(
          Layer.succeed(OrchestrationEngineService, {
            readEvents: () => Stream.empty,
            dispatch: (command) =>
              Ref.update(dispatched, (commands) => [...commands, command]).pipe(
                Effect.as({ sequence: 1 }),
              ),
            streamDomainEvents: Stream.empty,
            latestSequence: Effect.succeed(0),
          } satisfies OrchestrationEngineShape),
          Layer.succeed(ProjectionSnapshotQuery, {
            getShellSnapshot: () => Effect.succeed(snapshot),
          } as unknown as ProjectionSnapshotQueryShape),
          Layer.succeed(SourceControlProviderRegistry, {
            resolve: () => Effect.succeed(provider),
          } as unknown as SourceControlProviderRegistry["Service"]),
          Layer.succeed(VcsDriverRegistry, {
            resolve: () =>
              Effect.succeed({
                kind: "git",
                repository: {},
                driver: {
                  execute: ({ args }: { readonly args: ReadonlyArray<string> }) =>
                    Effect.succeed({
                      exitCode: 0,
                      stdout: args[0] === "symbolic-ref" ? "feature/renamed\n" : "def456\n",
                      stderr: "",
                      stdoutTruncated: false,
                      stderrTruncated: false,
                    }),
                },
              }),
          } as unknown as VcsDriverRegistry["Service"]),
          Layer.succeed(ThreadChangeRequestLinkStore, {
            get: () => Effect.succeed(Option.none()),
            upsert: (link) => Ref.update(links, (current) => [...current, link]),
          }),
          NodeServices.layer,
        );
        const reactor = yield* makeThreadPrSettlementReactor.pipe(Effect.provide(dependencies));
        yield* reactor.start();
        yield* reactor.drain;

        expect(yield* Ref.get(dispatched)).toHaveLength(1);
        expect(yield* Ref.get(links)).toMatchObject([
          {
            threadId: thread.id,
            provider: "github",
            number: 54,
            url: "https://example.test/pull/54",
            headRefName: "feature/renamed",
            headCommitSha: "def456",
          },
        ]);
      }),
    ),
  );

  it.effect("uses a persisted PR link without rediscovering a reused branch", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const thread = makeThread({ id: "linked", branch: "feature/deleted" });
        const snapshot = {
          snapshotSequence: 1,
          projects: [project],
          threads: [thread],
          updatedAt: "2026-08-25T00:00:00.000Z",
        } satisfies OrchestrationShellSnapshot;
        const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
        const branchLookups = yield* Ref.make(0);
        const link: ThreadChangeRequestLink = {
          threadId: thread.id,
          provider: "github",
          number: 55,
          url: "https://example.test/pull/55",
          headRefName: "feature/original",
          headCommitSha: "fed789",
          linkedAt: "2026-08-25T00:00:00.000Z",
          updatedAt: "2026-08-25T00:00:00.000Z",
        };
        const provider = {
          kind: "github",
          listChangeRequests: () =>
            Ref.update(branchLookups, (count) => count + 1).pipe(
              Effect.as([changeRequest("feature/deleted", "merged", 99)]),
            ),
          getChangeRequest: () => Effect.succeed(changeRequest("feature/original", "merged", 55)),
        } as unknown as SourceControlProvider.SourceControlProvider["Service"];
        const dependencies = Layer.mergeAll(
          Layer.succeed(OrchestrationEngineService, {
            readEvents: () => Stream.empty,
            dispatch: (command) =>
              Ref.update(dispatched, (commands) => [...commands, command]).pipe(
                Effect.as({ sequence: 1 }),
              ),
            streamDomainEvents: Stream.empty,
            latestSequence: Effect.succeed(0),
          } satisfies OrchestrationEngineShape),
          Layer.succeed(ProjectionSnapshotQuery, {
            getShellSnapshot: () => Effect.succeed(snapshot),
          } as unknown as ProjectionSnapshotQueryShape),
          Layer.succeed(SourceControlProviderRegistry, {
            resolve: () => Effect.succeed(provider),
          } as unknown as SourceControlProviderRegistry["Service"]),
          Layer.succeed(VcsDriverRegistry, {
            resolve: () =>
              Effect.succeed({
                kind: "git",
                repository: {},
                driver: {
                  execute: ({ args }: { readonly args: ReadonlyArray<string> }) =>
                    Effect.succeed({
                      exitCode: 0,
                      stdout: args[0] === "symbolic-ref" ? "feature/deleted\n" : "fed789\n",
                      stderr: "",
                      stdoutTruncated: false,
                      stderrTruncated: false,
                    }),
                },
              }),
          } as unknown as VcsDriverRegistry["Service"]),
          Layer.succeed(ThreadChangeRequestLinkStore, {
            get: () => Effect.succeed(Option.some(link)),
            upsert: () => Effect.void,
          }),
          NodeServices.layer,
        );
        const reactor = yield* makeThreadPrSettlementReactor.pipe(Effect.provide(dependencies));
        yield* reactor.start();
        yield* reactor.drain;

        expect(yield* Ref.get(dispatched)).toHaveLength(1);
        expect(yield* Ref.get(branchLookups)).toBe(0);
        expect((yield* Ref.get(dispatched))[0]?.commandId).toMatch(
          /^server:thread-pr-merged:linked:github:55:/u,
        );
      }),
    ),
  );
});
