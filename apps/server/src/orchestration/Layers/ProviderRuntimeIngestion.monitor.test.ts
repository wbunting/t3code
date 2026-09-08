import {
  EventId,
  ProviderDriverKind,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { runtimeEventToActivities } from "./ProviderRuntimeIngestion.ts";

const base = {
  eventId: EventId.make("monitor-status"),
  provider: ProviderDriverKind.make("pi"),
  threadId: ThreadId.make("thread"),
  createdAt: "2026-09-08T00:00:00.000Z",
};
describe("monitor status projection", () => {
  it("retains status and explicit clearing", () => {
    for (const status of ["◉ 1 monitor: CI", ""]) {
      const event = {
        ...base,
        type: "thread.metadata.updated",
        payload: { metadata: { piMonitorStatus: status } },
      } satisfies ProviderRuntimeEvent;
      expect(runtimeEventToActivities(event)[0]?.payload).toEqual({ status });
    }
  });
  it("clears monitors across session boundaries", () => {
    for (const type of ["session.started", "session.exited"] as const) {
      expect(runtimeEventToActivities({ ...base, type, payload: {} })[0]?.payload).toEqual({
        status: "",
      });
    }
  });
  it("ignores unrelated metadata and other providers", () => {
    expect(
      runtimeEventToActivities({
        ...base,
        type: "thread.metadata.updated",
        payload: { name: "renamed" },
      }),
    ).toEqual([]);
    expect(
      runtimeEventToActivities({
        ...base,
        provider: ProviderDriverKind.make("codex"),
        type: "session.started",
        payload: {},
      }),
    ).toEqual([]);
  });
});
