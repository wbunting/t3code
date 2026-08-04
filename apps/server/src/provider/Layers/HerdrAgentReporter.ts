import { type ThreadId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type * as ProcessRunner from "../../processRunner.ts";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1_000_000;
const SOURCE_PREFIX = "t3code:pi:";

export type HerdrAgentState = "idle" | "working" | "blocked";

export interface HerdrAgentReporterConfig {
  readonly command: string;
  readonly timeoutMs: number;
}

export interface HerdrAgentReporter {
  readonly report: (state: HerdrAgentState, message?: string) => Effect.Effect<void>;
  readonly release: Effect.Effect<void>;
}

type HerdrAgentUpdate =
  | {
      readonly _tag: "report";
      readonly state: HerdrAgentState;
      readonly message?: string;
    }
  | {
      readonly _tag: "release";
      readonly completed: Deferred.Deferred<void>;
    };

const HerdrPane = Schema.Struct({
  pane_id: Schema.String,
  cwd: Schema.optional(Schema.String),
  foreground_cwd: Schema.optional(Schema.String),
  focused: Schema.optional(Schema.Boolean),
  agent: Schema.optional(Schema.String),
  agent_session: Schema.optional(
    Schema.Struct({
      source: Schema.optional(Schema.String),
    }),
  ),
});

const HerdrPaneListResponse = Schema.Struct({
  result: Schema.Struct({
    type: Schema.Literal("pane_list"),
    panes: Schema.Array(HerdrPane),
  }),
});

type HerdrPane = typeof HerdrPane.Type;

const decodeHerdrPaneListResponse = Schema.decodeUnknownEffect(
  Schema.fromJsonString(HerdrPaneListResponse),
);

export class HerdrAgentReporterError extends Schema.TaggedErrorClass<HerdrAgentReporterError>()(
  "HerdrAgentReporterError",
  {
    operation: Schema.Literals(["list", "decode", "select", "report", "metadata", "release"]),
    cwd: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} the Pi session in Herdr: ${this.detail}`;
  }
}

export function resolveHerdrAgentReporterConfig(
  env: NodeJS.ProcessEnv = process.env,
): HerdrAgentReporterConfig | undefined {
  if (env.T3CODE_HERDR_AGENT_REPORTING?.trim() !== "1") return undefined;

  const configuredTimeout = Number.parseInt(
    env.T3CODE_HERDR_AGENT_REPORTING_TIMEOUT_MS?.trim() ?? "",
    10,
  );
  const timeoutMs =
    Number.isSafeInteger(configuredTimeout) &&
    configuredTimeout > 0 &&
    configuredTimeout <= MAX_TIMEOUT_MS
      ? configuredTimeout
      : DEFAULT_TIMEOUT_MS;

  return {
    command: env.T3CODE_HERDR_COMMAND?.trim() || "herdr",
    timeoutMs,
  };
}

export function selectHerdrPane(
  panes: ReadonlyArray<HerdrPane>,
  cwd: string,
): HerdrPane | undefined {
  return panes
    .filter((pane) =>
      [pane.cwd, pane.foreground_cwd].some(
        (candidate) => candidate !== undefined && candidate === cwd,
      ),
    )
    .filter(
      (pane) =>
        pane.agent === undefined ||
        (pane.agent === "pi" && pane.agent_session?.source?.startsWith(SOURCE_PREFIX) === true),
    )
    .sort((left, right) => {
      const focusOrder = Number(Boolean(right.focused)) - Number(Boolean(left.focused));
      return focusOrder !== 0 ? focusOrder : left.pane_id.localeCompare(right.pane_id);
    })[0];
}

const commandFailureDetail = (input: {
  readonly code: number | null;
  readonly stderr: string;
}): string => {
  const stderr = input.stderr.trim();
  return stderr.length > 0
    ? stderr.slice(0, 1_000)
    : `Herdr exited with code ${input.code ?? "unknown"}.`;
};

export const makeHerdrAgentReporter = Effect.fn("HerdrAgentReporter.make")(function* (input: {
  readonly cwd: string;
  readonly threadId: ThreadId;
  readonly env: NodeJS.ProcessEnv;
  readonly runner: ProcessRunner.ProcessRunner["Service"];
  readonly scope: Scope.Scope;
}) {
  const config = resolveHerdrAgentReporterConfig(input.env);
  if (config === undefined) return undefined;

  const run = Effect.fn("HerdrAgentReporter.run")(function* (
    operation: HerdrAgentReporterError["operation"],
    args: ReadonlyArray<string>,
  ) {
    const result = yield* input.runner
      .run({
        command: config.command,
        args,
        cwd: input.cwd,
        env: input.env,
        timeout: config.timeoutMs,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        outputMode: "truncate",
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new HerdrAgentReporterError({
              operation,
              cwd: input.cwd,
              detail: cause.message,
              cause,
            }),
        ),
      );

    if (result.code === null || Number(result.code) !== 0) {
      return yield* new HerdrAgentReporterError({
        operation,
        cwd: input.cwd,
        detail: commandFailureDetail({ code: result.code, stderr: result.stderr }),
      });
    }
    return result.stdout;
  });

  const paneListJson = yield* run("list", ["pane", "list"]);
  const paneList = yield* decodeHerdrPaneListResponse(paneListJson).pipe(
    Effect.mapError(
      (cause) =>
        new HerdrAgentReporterError({
          operation: "decode",
          cwd: input.cwd,
          detail: "Herdr returned an invalid pane list response.",
          cause,
        }),
    ),
  );
  const pane = selectHerdrPane(paneList.result.panes, input.cwd);
  if (pane === undefined) {
    return yield* new HerdrAgentReporterError({
      operation: "select",
      cwd: input.cwd,
      detail: "No unoccupied pane belongs to the Pi session working directory.",
    });
  }

  const source = `${SOURCE_PREFIX}${input.threadId}`;
  const metadataSource = `${source}:metadata`;
  let released = false;

  const reportNow = Effect.fn("HerdrAgentReporter.reportNow")(function* (
    state: HerdrAgentState,
    message?: string,
  ) {
    const normalizedMessage = message?.trim();
    yield* run("report", [
      "pane",
      "report-agent",
      pane.pane_id,
      "--source",
      source,
      "--agent",
      "pi",
      "--state",
      state,
      "--agent-session-id",
      String(input.threadId),
      ...(normalizedMessage ? ["--message", normalizedMessage.slice(0, 1_000)] : []),
    ]);
  });

  yield* reportNow("idle");
  yield* run("metadata", [
    "pane",
    "report-metadata",
    pane.pane_id,
    "--source",
    metadataSource,
    "--agent",
    "pi",
    "--applies-to-source",
    source,
    "--display-agent",
    "Pi · T3",
    "--state-label",
    "idle=done",
    "--state-label",
    "working=working",
    "--state-label",
    "blocked=needs input",
  ]).pipe(
    Effect.catchTag("HerdrAgentReporterError", (error) =>
      Effect.logWarning("herdr.pi.metadata.failed", {
        cwd: input.cwd,
        detail: error.detail,
        paneId: pane.pane_id,
        threadId: input.threadId,
      }),
    ),
  );

  const logUpdateFailure = (operation: "report" | "release", error: HerdrAgentReporterError) =>
    Effect.logWarning("herdr.pi.lifecycle-update.failed", {
      cwd: input.cwd,
      detail: error.detail,
      operation,
      paneId: pane.pane_id,
      threadId: input.threadId,
    });

  const updates = yield* Queue.unbounded<HerdrAgentUpdate>();
  yield* Stream.fromQueue(updates).pipe(
    Stream.runForEach((update) =>
      Effect.gen(function* () {
        if (update._tag === "report") {
          yield* reportNow(update.state, update.message).pipe(
            Effect.catchTag("HerdrAgentReporterError", (error) =>
              logUpdateFailure("report", error),
            ),
          );
          return;
        }

        yield* run("release", [
          "pane",
          "release-agent",
          pane.pane_id,
          "--source",
          source,
          "--agent",
          "pi",
        ]).pipe(
          Effect.catchTag("HerdrAgentReporterError", (error) => logUpdateFailure("release", error)),
        );
        yield* Deferred.succeed(update.completed, undefined).pipe(Effect.ignore);
        yield* Queue.shutdown(updates);
      }),
    ),
    Effect.forkIn(input.scope),
  );

  const report = (state: HerdrAgentState, message?: string): Effect.Effect<void> =>
    released
      ? Effect.void
      : Queue.offer(updates, {
          _tag: "report",
          state,
          ...(message ? { message } : {}),
        }).pipe(Effect.asVoid);

  const release = Effect.gen(function* () {
    if (released) return;
    released = true;
    const completed = yield* Deferred.make<void>();
    const offered = yield* Queue.offer(updates, { _tag: "release", completed });
    if (offered) yield* Deferred.await(completed);
  });

  return {
    report,
    release,
  } satisfies HerdrAgentReporter;
});
