import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ThreadId } from "@t3tools/contracts";

import type * as ProcessRunner from "../../processRunner.ts";
import {
  makeHerdrAgentReporter,
  resolveHerdrAgentReporterConfig,
  selectHerdrPane,
} from "./HerdrAgentReporter.ts";

it("keeps Herdr reporting disabled unless explicitly enabled", () => {
  assert.isUndefined(resolveHerdrAgentReporterConfig({}));
  assert.deepStrictEqual(
    resolveHerdrAgentReporterConfig({
      T3CODE_HERDR_AGENT_REPORTING: "1",
      T3CODE_HERDR_COMMAND: " /usr/bin/herdr ",
      T3CODE_HERDR_AGENT_REPORTING_TIMEOUT_MS: "9000",
    }),
    { command: "/usr/bin/herdr", timeoutMs: 9_000 },
  );
  assert.equal(
    resolveHerdrAgentReporterConfig({
      T3CODE_HERDR_AGENT_REPORTING: "1",
      T3CODE_HERDR_AGENT_REPORTING_TIMEOUT_MS: "999999",
    })?.timeoutMs,
    5_000,
  );
});

it("selects an unoccupied pane in the session cwd without taking over an interactive agent", () => {
  assert.deepStrictEqual(
    selectHerdrPane(
      [
        {
          pane_id: "w1:p1",
          cwd: "/worktrees/feature",
          focused: true,
          agent: "pi",
          agent_session: { source: "herdr:pi" },
        },
        {
          pane_id: "w1:p2",
          cwd: "/worktrees/feature",
          focused: false,
        },
        {
          pane_id: "w2:p1",
          cwd: "/worktrees/other",
          focused: false,
        },
      ],
      "/worktrees/feature",
    )?.pane_id,
    "w1:p2",
  );
});

it("reclaims a stale T3 Pi pane after a server restart", () => {
  assert.equal(
    selectHerdrPane(
      [
        {
          pane_id: "w1:p1",
          cwd: "/worktrees/feature",
          agent: "pi",
          agent_session: { source: "t3code:pi:old-thread" },
        },
      ],
      "/worktrees/feature",
    )?.pane_id,
    "w1:p1",
  );
});

it.effect("reports Pi lifecycle state against the matching Herdr pane", () =>
  Effect.gen(function* () {
    const calls: Array<{ readonly command: string; readonly args: ReadonlyArray<string> }> = [];
    const runner = {
      run: (input) =>
        Effect.sync(() => {
          calls.push({ command: input.command, args: input.args });
          return {
            stdout:
              input.args[0] === "pane" && input.args[1] === "list"
                ? '{"id":"cli:pane:list","result":{"type":"pane_list","panes":[{"pane_id":"w1:p1","cwd":"/worktrees/feature","focused":true}]}}'
                : "{}",
            stderr: "",
            code: ChildProcessSpawner.ExitCode(0),
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
          };
        }),
    } satisfies ProcessRunner.ProcessRunner["Service"];

    const reporter = yield* makeHerdrAgentReporter({
      cwd: "/worktrees/feature",
      threadId: ThreadId.make("thread-123"),
      env: {
        T3CODE_HERDR_AGENT_REPORTING: "1",
        T3CODE_HERDR_COMMAND: "/usr/bin/herdr",
      },
      runner,
      scope: yield* Scope.make(),
    });
    assert.isDefined(reporter);
    yield* reporter!.report("working", "Running Pi turn");
    yield* reporter!.report("blocked", "bash");
    yield* reporter!.release;

    assert.deepStrictEqual(
      calls.map((call) => call.args.slice(0, 3)),
      [
        ["pane", "list"],
        ["pane", "report-agent", "w1:p1"],
        ["pane", "report-metadata", "w1:p1"],
        ["pane", "report-agent", "w1:p1"],
        ["pane", "report-agent", "w1:p1"],
        ["pane", "release-agent", "w1:p1"],
      ],
    );
    assert.deepStrictEqual(calls[1]?.args, [
      "pane",
      "report-agent",
      "w1:p1",
      "--source",
      "t3code:pi:thread-123",
      "--agent",
      "pi",
      "--state",
      "idle",
      "--agent-session-id",
      "thread-123",
    ]);
    assert.deepStrictEqual(calls[3]?.args.slice(-2), ["--message", "Running Pi turn"]);
  }),
);
