import {
  EventId,
  ThreadId,
  type OrchestrationSession,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { threadMonitorStatus } from "./threadMonitorStatus";

const session: OrchestrationSession = {
  threadId: ThreadId.make("thread"),
  status: "ready",
  providerName: "pi",
  runtimeMode: "full-access",
  activeTurnId: null,
  lastError: null,
  updatedAt: "2026-09-08T00:00:00.000Z",
};
const activity = (status: string): OrchestrationThreadActivity => ({
  id: EventId.make("event"),
  kind: "pi.monitor.status",
  summary: "Monitor status",
  tone: "info",
  turnId: null,
  payload: { status },
  createdAt: session.updatedAt,
});
describe("threadMonitorStatus", () => {
  it("shows active monitors between turns and during work", () => {
    expect(threadMonitorStatus([activity("CI")], session)).toBe("CI");
    expect(threadMonitorStatus([activity("CI")], { ...session, status: "running" })).toBe("CI");
  });
  it("honors the latest clearing and replacement", () => {
    expect(threadMonitorStatus([activity("CI"), activity("")], session)).toBeNull();
    expect(threadMonitorStatus([activity("CI"), activity("Deploy")], session)).toBe("Deploy");
  });
  it("does not claim an inactive session is monitoring", () => {
    for (const status of ["starting", "stopped", "error", "interrupted"] as const) {
      expect(threadMonitorStatus([activity("CI")], { ...session, status })).toBeNull();
    }
    expect(threadMonitorStatus([activity("CI")], null)).toBeNull();
    expect(threadMonitorStatus([], session)).toBeNull();
  });
});
