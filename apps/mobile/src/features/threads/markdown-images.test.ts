import { describe, expect, it } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";

import {
  markdownContainsWorkspaceImage,
  resolveMarkdownWorkspaceImageResource,
} from "./markdown-images";

const threadId = ThreadId.make("thread-1");

describe("mobile Markdown workspace images", () => {
  it("maps a relative image to the thread workspace asset resource", () => {
    expect(
      resolveMarkdownWorkspaceImageResource({
        src: "artifacts/hydra-evidence/run/snapshot.png",
        workspaceRoot: "/workspace/slateo",
        threadId,
      }),
    ).toEqual({
      _tag: "workspace-file",
      threadId,
      path: "artifacts/hydra-evidence/run/snapshot.png",
    });
  });

  it("does not rewrite remote images", () => {
    expect(
      resolveMarkdownWorkspaceImageResource({
        src: "https://example.com/snapshot.png",
        workspaceRoot: "/workspace/slateo",
        threadId,
      }),
    ).toBeNull();
  });

  it("finds workspace images in parsed Markdown", () => {
    expect(
      markdownContainsWorkspaceImage(
        "Before\n\n![Chat success](artifacts/hydra-evidence/run/snapshot.png)\n\nAfter",
        "/workspace/slateo",
      ),
    ).toBe(true);
    expect(
      markdownContainsWorkspaceImage(
        "![Remote](https://example.com/snapshot.png)",
        "/workspace/slateo",
      ),
    ).toBe(false);
  });
});
