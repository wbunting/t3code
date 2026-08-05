import type { ThreadId } from "@t3tools/contracts";
import { useCallback } from "react";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useCopyToClipboard } from "./useCopyToClipboard";

export function useCopyThreadId(): (threadId: ThreadId) => void {
  const { copyToClipboard } = useCopyToClipboard<ThreadId>({
    target: "thread ID",
    onCopy: (threadId) => {
      toastManager.add({
        type: "success",
        title: "Thread ID copied",
        description: threadId,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy thread ID",
          description: error.message,
        }),
      );
    },
  });

  return useCallback(
    (threadId: ThreadId) => copyToClipboard(threadId, threadId),
    [copyToClipboard],
  );
}
