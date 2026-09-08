import type { ScopedThreadRef, ThreadVmStatus } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { useEnvironment, useEnvironmentHttpBaseUrl } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";
import { useRightPanelStore } from "~/rightPanelStore";
import { isPreviewSupportedInRuntime } from "~/previewStateStore";
import { openPreviewSession } from "../preview/openPreviewSession";

const vmLabels: Record<ThreadVmStatus["state"], string> = {
  none: "No VM",
  loading: "VM · loading",
  live: "VM · live",
  failed: "VM · failed",
  stopped: "VM · stopped",
  unknown: "VM · unknown",
};

export function ThreadVmIndicator({
  threadRef,
  summary = false,
}: {
  threadRef: ScopedThreadRef;
  summary?: boolean;
}) {
  const environment = useEnvironment(threadRef.environmentId);
  const baseUrl = useEnvironmentHttpBaseUrl(threadRef.environmentId);
  const connected = environment?.connection.phase === "connected";
  const query = useEnvironmentQuery(
    connected
      ? previewEnvironment.vmStatus({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  const openConsole = useAtomCommand(previewEnvironment.vmConsole);
  const openPreview = useAtomCommand(previewEnvironment.open);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const { refresh, isPending } = query;
  useEffect(() => {
    if (!connected) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && !isPending) refresh();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [connected, refresh, isPending]);
  if (!summary && (!connected || query.data?.state === "none" || (!query.data && !query.error)))
    return null;
  const state = query.error ? "unknown" : (query.data?.state ?? "unknown");
  const supported = isPreviewSupportedInRuntime();
  const title = openError ?? query.error ?? query.data?.detail ?? "VM status unavailable";
  const dotClass =
    state === "live"
      ? "bg-emerald-500"
      : state === "failed"
        ? "bg-red-500"
        : state === "loading"
          ? "bg-amber-500"
          : "bg-muted-foreground";
  if (summary) {
    const label = !connected
      ? "VM · disconnected"
      : !query.data && !query.error
        ? "Checking VM…"
        : vmLabels[state];
    return (
      <div className="flex min-w-0 items-center gap-2 text-foreground/75">
        <span className="flex size-3 shrink-0 items-center justify-center" aria-hidden>
          <span
            className={`size-1.5 rounded-full ${connected ? dotClass : "bg-muted-foreground"}`}
          />
        </span>
        <span>{label}</span>
      </div>
    );
  }
  const open = async () => {
    if (!baseUrl || opening) return;
    setOpening(true);
    setOpenError(null);
    try {
      const result = await openConsole({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
      if (result._tag === "Failure") {
        setOpenError(
          "Could not open the VM desktop. Its desktop display or connection may not be ready. Click to retry.",
        );
        return;
      }
      const preview = await openPreviewSession({
        threadRef,
        openPreview,
        url: new URL(result.value.path, baseUrl).href,
      });
      if (preview._tag === "Success")
        useRightPanelStore.getState().openBrowser(threadRef, preview.value.tabId);
      else setOpenError("Could not open the built-in browser. Click to retry.");
    } catch {
      setOpenError("Could not connect to the VM desktop. Click to retry.");
    } finally {
      setOpening(false);
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() => {
              void open();
            }}
            disabled={state !== "live" || opening || !supported}
            aria-label={opening ? "Opening VM desktop" : `${vmLabels[state]}: ${title}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground enabled:hover:bg-accent disabled:cursor-default"
          >
            <span
              aria-hidden
              className={`size-1.5 rounded-full ${state === "live" ? "bg-emerald-500" : state === "failed" ? "bg-red-500" : state === "loading" ? "bg-amber-500" : "bg-muted-foreground"}`}
            />
            {opening ? "Opening desktop…" : openError ? "Desktop unavailable" : vmLabels[state]}
          </button>
        }
      />
      <TooltipPopup>{`${title}${state === "live" ? (supported ? ". Open VM desktop" : ". Open the desktop client to control this VM") : ""}`}</TooltipPopup>
    </Tooltip>
  );
}
