import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

export type ThreadMicrovmDesiredState = "active" | "released";

export interface ThreadMicrovmLifecycleInput {
  readonly threadId: string;
  readonly worktreePath: string;
  readonly desiredState: ThreadMicrovmDesiredState;
}

export interface ThreadMicrovmLifecycleConfig {
  readonly baseUrl: string;
  readonly token: string;
}

export class ThreadMicrovmLifecycleError extends Schema.TaggedErrorClass<ThreadMicrovmLifecycleError>()(
  "ThreadMicrovmLifecycleError",
  {
    threadId: Schema.String,
    desiredState: Schema.Literals(["active", "released"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Could not synchronize ${this.desiredState} microVM lifecycle for thread ${this.threadId}.`;
  }
}

export interface ThreadMicrovmLifecycleShape {
  readonly enabled: boolean;
  readonly sync: (
    input: ThreadMicrovmLifecycleInput,
  ) => Effect.Effect<void, ThreadMicrovmLifecycleError>;
}

export class ThreadMicrovmLifecycle extends Context.Service<
  ThreadMicrovmLifecycle,
  ThreadMicrovmLifecycleShape
>()("t3/hydra/ThreadMicrovmLifecycle") {}

const make = Effect.gen(function* () {
  const environment = yield* HostProcessEnvironment;
  const httpClient = yield* HttpClient.HttpClient;
  const url = environment.T3CODE_HYDRA_POOL_URL?.trim();
  const token = environment.T3CODE_HYDRA_POOL_TOKEN?.trim();
  const enabled = Boolean(url && token);

  if ((url && !token) || (!url && token)) {
    yield* Effect.logWarning(
      "Hydra thread microVM lifecycle is disabled because its URL and token must both be configured",
    );
  }

  const sync = Effect.fn("ThreadMicrovmLifecycle.sync")(function* (
    input: ThreadMicrovmLifecycleInput,
  ) {
    if (!enabled || !url || !token) return;
    const endpoint = `${url.replace(/\/+$/g, "")}/thread-microvms/${encodeURIComponent(input.threadId)}`;
    yield* HttpClientRequest.put(endpoint).pipe(
      HttpClientRequest.bearerToken(token),
      HttpClientRequest.bodyJson({
        worktreePath: input.worktreePath,
        desiredState: input.desiredState,
      }),
      Effect.flatMap(httpClient.execute),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.timeout("10 seconds"),
      Effect.asVoid,
      Effect.mapError(
        (cause) =>
          new ThreadMicrovmLifecycleError({
            threadId: input.threadId,
            desiredState: input.desiredState,
            cause,
          }),
      ),
    );
  });

  return { enabled, sync } satisfies ThreadMicrovmLifecycleShape;
});

export const layer = Layer.effect(ThreadMicrovmLifecycle, make);
