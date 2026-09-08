import type { ScopedThreadRef } from "@t3tools/contracts";
import { useThread, useThreadStatus } from "~/state/entities";
import { useMemo } from "react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { useEnvironment } from "~/state/environments";
import { threadMonitorStatus } from "./threadMonitorStatus";

export function ThreadMonitorIndicator({
  threadRef,
  summary = false,
}: {
  threadRef: ScopedThreadRef;
  summary?: boolean;
}) {
  const thread = useThread(threadRef);
  const detailStatus = useThreadStatus(threadRef);
  const session = thread?.session ?? null;
  const environment = useEnvironment(threadRef.environmentId);
  const status = useMemo(
    () => threadMonitorStatus(thread?.activities ?? [], session),
    [thread?.activities, session],
  );
  const connected = environment?.connection.phase === "connected";
  if (summary) {
    const label = !connected
      ? "Monitor · disconnected"
      : detailStatus !== "live"
        ? "Checking monitors…"
        : status
          ? `${session?.status === "running" ? "Monitor active" : "Waiting · monitor active"} · ${status}`
          : "No active monitors";
    return (
      <div className="flex min-w-0 items-start gap-2 text-foreground/75">
        <span className="flex size-3 shrink-0 items-center justify-center mt-0.5" aria-hidden>
          <span
            className={`size-1.5 rounded-full ${connected && status ? "bg-sky-500" : "bg-muted-foreground"}`}
          />
        </span>
        <span className="min-w-0 break-words">{label}</span>
      </div>
    );
  }
  if (!status) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={
              connected ? `Active monitor: ${status}` : `Monitor status unknown: ${status}`
            }
            className="inline-flex max-w-48 shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground"
          >
            <span
              aria-hidden
              className={`size-1.5 shrink-0 rounded-full ${connected ? "bg-sky-500" : "bg-muted-foreground"}`}
            />
            <span className="truncate">
              {!connected
                ? "Monitor · disconnected"
                : session?.status === "running"
                  ? "Monitor active"
                  : "Waiting · monitor active"}
            </span>
          </span>
        }
      />
      <TooltipPopup>{connected ? status : `Last known status: ${status}`}</TooltipPopup>
    </Tooltip>
  );
}
