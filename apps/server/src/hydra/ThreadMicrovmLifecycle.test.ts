import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { describe, expect, it } from "vite-plus/test";

import { layer, ThreadMicrovmLifecycle } from "./ThreadMicrovmLifecycle.ts";

describe("ThreadMicrovmLifecycle", () => {
  it("sends authenticated exact thread ownership intent to Hydra", async () => {
    const requests: HttpClientRequest.HttpClientRequest[] = [];
    const runtime = ManagedRuntime.make(
      layer.pipe(
        Layer.provide(
          Layer.succeed(HostProcessEnvironment, {
            T3CODE_HYDRA_POOL_URL: "http://127.0.0.1:7431/",
            T3CODE_HYDRA_POOL_TOKEN: "secret-token",
          }),
        ),
        Layer.provide(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) => {
              requests.push(request);
              return Effect.succeed(
                HttpClientResponse.fromWeb(request, Response.json({ ok: true })),
              );
            }),
          ),
        ),
      ),
    );
    try {
      const lifecycle = await runtime.runPromise(Effect.service(ThreadMicrovmLifecycle));
      await runtime.runPromise(
        lifecycle.sync({
          threadId: "6328d6ce-ea73-4bcd-9d11-f4c02ae59eba",
          worktreePath: "/worktrees/thread-1",
          desiredState: "released",
        }),
      );

      expect(requests).toHaveLength(1);
      const request = requests[0]!;
      expect(request.method).toBe("PUT");
      expect(request.url).toBe(
        "http://127.0.0.1:7431/thread-microvms/6328d6ce-ea73-4bcd-9d11-f4c02ae59eba",
      );
      expect(request.headers.authorization).toBe("Bearer secret-token");
      const rawBody = (request.body as { readonly body?: Uint8Array }).body;
      expect(JSON.parse(new TextDecoder().decode(rawBody))).toEqual({
        worktreePath: "/worktrees/thread-1",
        desiredState: "released",
      });
    } finally {
      await runtime.dispose();
    }
  });
});
