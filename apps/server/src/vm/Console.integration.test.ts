// @effect-diagnostics nodeBuiltinImport:off
import * as NodeStream from "node:stream";
import * as NodeEvents from "node:events";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { it, expect } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServer, HttpClient } from "effect/unstable/http";

vi.mock("node:child_process", () => ({
  spawn: () => {
    const child = new NodeEvents.EventEmitter();
    const stdin = new NodeStream.PassThrough();
    const stdout = new NodeStream.PassThrough();
    stdin.on("data", (data) => {
      stdout.write(data);
    });
    stdout.write("RFB 003.008\n");
    return Object.assign(child, {
      stdin,
      stdout,
      kill: () => {
        stdin.destroy();
        stdout.destroy();
        return true;
      },
    });
  },
}));

import { createVmConsole, vmConsoleRouteLayer } from "./Console.ts";

it.effect("bridges binary VNC traffic in both directions over an upgraded HTTP connection", () =>
  Effect.gen(function* () {
    yield* vmConsoleRouteLayer.pipe(HttpRouter.serve, Layer.build);
    const server = yield* HttpServer.HttpServer;
    if (server.address._tag !== "TcpAddress") throw new Error("Expected TCP server");
    const { path } = createVmConsole("100.1.2.3", yield* Clock.currentTimeMillis);
    const url = `ws://127.0.0.1:${server.address.port}/api/vm-console/${path.split("#")[1]}`;
    const messages = yield* Effect.tryPromise(
      () =>
        new Promise<string[]>((resolve, reject) => {
          const socket = new WebSocket(url);
          socket.binaryType = "arraybuffer";
          const received: string[] = [];
          socket.addEventListener("error", () => reject(new Error("WebSocket upgrade failed")));
          socket.addEventListener("message", (event) => {
            received.push(new TextDecoder().decode(event.data as ArrayBuffer));
            if (received.length === 1) socket.send(new TextEncoder().encode("client input"));
            else {
              socket.close();
              resolve(received);
            }
          });
        }),
    );
    expect(messages).toEqual(["RFB 003.008\n", "client input"]);
    const response = yield* HttpClient.get("/api/vm-console/invalid");
    expect(response.status).toBe(403);
  }).pipe(Effect.provide(NodeHttpServer.layerTest)),
);
