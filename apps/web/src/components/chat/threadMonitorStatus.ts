import type { OrchestrationSession, OrchestrationThreadActivity } from "@t3tools/contracts";

export function threadMonitorStatus(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  session: OrchestrationSession | null,
): string | null {
  if (!session || !["ready", "running"].includes(session.status)) return null;
  for (let index = activities.length - 1; index >= 0; index--) {
    const activity = activities[index];
    if (activity?.kind !== "pi.monitor.status") continue;
    const payload = activity.payload;
    if (typeof payload !== "object" || payload === null || !("status" in payload)) return null;
    return typeof payload.status === "string" && payload.status.trim()
      ? payload.status.trim()
      : null;
  }
  return null;
}
