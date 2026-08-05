import type { ThreadId } from "@t3tools/contracts";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";
import { resolveMarkdownLinkPresentation } from "@t3tools/mobile-markdown-text/links";

import { resolveWorkspaceRelativeFilePath } from "../files/filePath";

const MARKDOWN_IMAGE_DESTINATION_PATTERN =
  /!\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^\n)]*\)))?\s*\)/g;

export function resolveMarkdownWorkspaceImageResource(input: {
  readonly src: string;
  readonly workspaceRoot: string | null | undefined;
  readonly threadId: ThreadId;
}) {
  const presentation = resolveMarkdownLinkPresentation(input.src);
  if (presentation.kind !== "file") return null;

  const path = resolveWorkspaceRelativeFilePath(input.workspaceRoot, presentation.path);
  if (!path || !isWorkspaceImagePreviewPath(path)) return null;

  return {
    _tag: "workspace-file" as const,
    threadId: input.threadId,
    path,
  };
}

function markdownImageSources(markdown: string): ReadonlyArray<string> {
  return [...markdown.matchAll(MARKDOWN_IMAGE_DESTINATION_PATTERN)].flatMap((match) => {
    const source = match[1] ?? match[2];
    return source ? [source] : [];
  });
}

function isWorkspaceImage(src: string, workspaceRoot: string | null | undefined) {
  const presentation = resolveMarkdownLinkPresentation(src);
  if (presentation.kind === "file") {
    const path = resolveWorkspaceRelativeFilePath(workspaceRoot, presentation.path);
    return Boolean(path && isWorkspaceImagePreviewPath(path));
  }
  return false;
}

export function markdownContainsWorkspaceImage(
  markdown: string,
  workspaceRoot: string | null | undefined,
): boolean {
  return markdownImageSources(markdown).some((src) => isWorkspaceImage(src, workspaceRoot));
}
