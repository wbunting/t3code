import type { AssetResource, ScopedThreadRef } from "@t3tools/contracts";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";

import { resolveMarkdownFileLinkTarget } from "./markdown-links";

export function resolveMarkdownWorkspaceImageResource(input: {
  readonly src: string | undefined;
  readonly cwd: string | undefined;
  readonly threadRef: ScopedThreadRef | undefined;
}): Extract<AssetResource, { readonly _tag: "workspace-file" }> | null {
  if (!input.threadRef) return null;

  const path = resolveMarkdownFileLinkTarget(input.src, input.cwd);
  if (!path || !isWorkspaceImagePreviewPath(path)) return null;

  return {
    _tag: "workspace-file",
    threadId: input.threadRef.threadId,
    path,
  };
}
