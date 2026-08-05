import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { resolveMarkdownWorkspaceImageResource } from "./markdown-images";

const threadRef = {
  environmentId: EnvironmentId.make("hydra"),
  threadId: ThreadId.make("thread-1"),
};

describe("resolveMarkdownWorkspaceImageResource", () => {
  it("resolves a relative Markdown image against the thread cwd", () => {
    expect(
      resolveMarkdownWorkspaceImageResource({
        src: "artifacts/hydra-evidence/run/snapshot.png",
        cwd: "/workspace/slateo",
        threadRef,
      }),
    ).toEqual({
      _tag: "workspace-file",
      threadId: threadRef.threadId,
      path: "/workspace/slateo/artifacts/hydra-evidence/run/snapshot.png",
    });
  });

  it("leaves remote images on their original URL path", () => {
    expect(
      resolveMarkdownWorkspaceImageResource({
        src: "https://example.com/snapshot.png",
        cwd: "/workspace/slateo",
        threadRef,
      }),
    ).toBeNull();
  });

  it("requires thread context and an image preview type", () => {
    expect(
      resolveMarkdownWorkspaceImageResource({
        src: "artifacts/report.html",
        cwd: "/workspace/slateo",
        threadRef,
      }),
    ).toBeNull();
    expect(
      resolveMarkdownWorkspaceImageResource({
        src: "artifacts/snapshot.png",
        cwd: "/workspace/slateo",
        threadRef: undefined,
      }),
    ).toBeNull();
  });
});
