import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/unstable/process";

import type { VcsProcessInput } from "./VcsProcess.ts";
import * as VcsProcess from "./VcsProcess.ts";
import {
  makeWorktreeHelperInvocation,
  resolveWorktreeHelperConfig,
  runWorktreeHelper,
} from "./WorktreeHelper.ts";

const config = {
  command: "/usr/local/bin/worktree-helper",
  timeoutMs: 90_000,
} as const;

it("leaves normal Git worktree creation enabled when no helper is configured", () => {
  assert.isUndefined(resolveWorktreeHelperConfig({}));
});

it("normalizes the helper command and bounds its timeout", () => {
  assert.deepStrictEqual(
    resolveWorktreeHelperConfig({
      T3CODE_WORKTREE_HELPER: "  /usr/local/bin/worktree-helper  ",
      T3CODE_WORKTREE_HELPER_TIMEOUT_MS: "90000",
    }),
    config,
  );
  assert.equal(
    resolveWorktreeHelperConfig({
      T3CODE_WORKTREE_HELPER: "worktree-helper",
      T3CODE_WORKTREE_HELPER_TIMEOUT_MS: "999999999",
    })?.timeoutMs,
    15 * 60 * 1_000,
  );
});

it.effect("routes new branches through the helper's Herder flow", () =>
  Effect.gen(function* () {
    const invocation = yield* makeWorktreeHelperInvocation(config, {
      cwd: "/repos/slateo",
      refName: "origin/main",
      newRefName: "feature/from-phone",
      baseRefName: "origin/main",
      path: null,
    });

    assert.deepStrictEqual(invocation.args, ["new", "feature/from-phone"]);
    assert.deepStrictEqual(invocation.env, {
      HERDR_REPO: "/repos/slateo",
      WT_FG: "0",
    });
  }),
);

it.effect("routes existing branches through helper checkout", () => {
  const calls: VcsProcessInput[] = [];
  const layer = Layer.mock(VcsProcess.VcsProcess)({
    run: (input) =>
      Effect.sync(() => {
        calls.push(input);
        return {
          exitCode: ChildProcessSpawner.ExitCode(0),
          stdout: "ready",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }),
  });

  return runWorktreeHelper(config, {
    cwd: "/repos/slateo",
    refName: "feature/existing",
    path: null,
  }).pipe(
    Effect.provide(layer),
    Effect.tap(() =>
      Effect.sync(() => {
        assert.equal(calls.length, 1);
        assert.deepStrictEqual(calls[0]?.args, ["checkout", "feature/existing"]);
        assert.equal(calls[0]?.env?.HERDR_REPO, "/repos/slateo");
      }),
    ),
  );
});

it.effect("rejects explicit paths before invoking the helper", () =>
  Effect.gen(function* () {
    const result = yield* makeWorktreeHelperInvocation(config, {
      cwd: "/repos/slateo",
      refName: "main",
      newRefName: "feature/path-owned-by-t3",
      path: "/tmp/explicit",
    }).pipe(Effect.result);

    assert.isTrue(result._tag === "Failure");
  }),
);
