import * as Effect from "effect/Effect";

import { GitCommandError, type VcsCreateWorktreeInput } from "@t3tools/contracts";
import * as VcsProcess from "./VcsProcess.ts";

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1_000;
const MAX_TIMEOUT_MS = 60 * 60 * 1_000;

export interface WorktreeHelperConfig {
  readonly command: string;
  readonly timeoutMs: number;
}

export interface WorktreeHelperInvocation {
  readonly args: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
}

export function resolveWorktreeHelperConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorktreeHelperConfig | undefined {
  const command = env.T3CODE_WORKTREE_HELPER?.trim();
  if (!command) return undefined;

  const configuredTimeout = Number.parseInt(
    env.T3CODE_WORKTREE_HELPER_TIMEOUT_MS?.trim() ?? "",
    10,
  );
  const timeoutMs =
    Number.isSafeInteger(configuredTimeout) &&
    configuredTimeout > 0 &&
    configuredTimeout <= MAX_TIMEOUT_MS
      ? configuredTimeout
      : DEFAULT_TIMEOUT_MS;

  return { command, timeoutMs };
}

export const makeWorktreeHelperInvocation = Effect.fn(
  "WorktreeHelper.makeWorktreeHelperInvocation",
)(function* (
  config: WorktreeHelperConfig,
  input: VcsCreateWorktreeInput,
): Effect.fn.Return<WorktreeHelperInvocation, GitCommandError> {
  if (input.path !== null) {
    return yield* new GitCommandError({
      operation: "GitVcsDriver.createWorktree.helper",
      command: config.command,
      cwd: input.cwd,
      detail:
        "The configured worktree helper owns worktree placement and cannot honor an explicit path.",
    });
  }

  return {
    args: input.newRefName ? ["new", input.newRefName] : ["checkout", input.refName],
    env: {
      HERDR_REPO: input.cwd,
      WT_FG: "0",
    },
  };
});

export const runWorktreeHelper = Effect.fn("WorktreeHelper.run")(function* (
  config: WorktreeHelperConfig,
  input: VcsCreateWorktreeInput,
) {
  const invocation = yield* makeWorktreeHelperInvocation(config, input);
  const processRunner = yield* VcsProcess.VcsProcess;

  yield* processRunner
    .run({
      operation: "GitVcsDriver.createWorktree.helper",
      command: config.command,
      args: invocation.args,
      cwd: input.cwd,
      env: invocation.env,
      timeoutMs: config.timeoutMs,
      maxOutputBytes: 1_000_000,
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new GitCommandError({
            operation: "GitVcsDriver.createWorktree.helper",
            command: config.command,
            cwd: input.cwd,
            argumentCount: invocation.args.length,
            detail: cause.message,
            cause,
          }),
      ),
    );
});
