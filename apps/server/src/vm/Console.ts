// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeStream from "node:stream";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

const CONSOLE_TTL_MS = 30 * 60 * 1000;
const consoles = new Map<string, { address: string; expiresAt: number }>();

export function createVmConsole(address: string, now: number) {
  for (const [token, entry] of consoles) if (entry.expiresAt <= now) consoles.delete(token);
  if (consoles.size >= 128) throw new Error("Too many open VM consoles");
  const token = NodeCrypto.randomBytes(32).toString("hex");
  consoles.set(token, { address, expiresAt: now + CONSOLE_TTL_MS });
  return { path: `/vm-console.html#${token}` };
}

export function resolveVmConsole(token: string, now: number) {
  const entry = consoles.get(token);
  if (!entry || entry.expiresAt <= now) return null;
  return entry;
}

export const vmConsoleRouteLayer = HttpRouter.add(
  "GET",
  "/api/vm-console/:token",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const token = request.url.split("?")[0]?.split("/").at(-1) ?? "";
    const now = yield* Clock.currentTimeMillis;
    const entry = resolveVmConsole(token, now);
    if (!entry)
      return HttpServerResponse.text("Console expired. Reopen it from the thread header.", {
        status: 403,
      });
    const socket = yield* request.upgrade;
    const remote = yield* NodeSocket.fromDuplex(
      Effect.acquireRelease(
        Effect.sync(() => {
          const child = NodeChildProcess.spawn(
            "ssh",
            [
              "-o",
              "BatchMode=yes",
              "-o",
              "StrictHostKeyChecking=accept-new",
              "-o",
              "ConnectTimeout=10",
              "-W",
              "127.0.0.1:5909",
              `will@${entry.address}`,
            ],
            { stdio: ["pipe", "pipe", "ignore"] },
          );
          const duplex = NodeStream.Duplex.from({
            readable: child.stdout!,
            writable: child.stdin!,
          });
          // Socket removes its listener before scoped teardown aborts the duplex.
          duplex.on("error", () => {});
          child.on("error", (error) => duplex.destroy(error));
          duplex.once("close", () => {
            child.kill("SIGTERM");
          });
          return duplex;
        }),
        (duplex) =>
          Effect.sync(() => {
            duplex.destroy();
          }),
      ),
    );
    const writeClient = yield* socket.writer;
    const writeRemote = yield* remote.writer;
    yield* Effect.raceFirst(socket.runRaw(writeRemote), remote.runRaw(writeClient)).pipe(
      Effect.timeout(`${Math.max(1, entry.expiresAt - now)} millis`),
      Effect.ignore,
    );
    return HttpServerResponse.empty();
  }).pipe(Effect.scoped),
);
