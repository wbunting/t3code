import { describe, expect, it } from "vite-plus/test";
import { parseGitHubImageUrl } from "./githubImage.ts";

describe("GitHub repository images", () => {
  it("maps blob and raw URLs to the same authenticated API request", () => {
    const sha = "7e526dee3c9dc914efea168d394041ad3c8057ad";
    const expected = {
      endpoint: `repos/slateo/slateo/contents/snapshot.png?ref=${sha}`,
      extension: ".png",
      immutable: true,
    };
    expect(
      parseGitHubImageUrl(`https://github.com/slateo/slateo/blob/${sha}/snapshot.png?raw=true`),
    ).toEqual(expected);
    expect(
      parseGitHubImageUrl(`https://raw.githubusercontent.com/slateo/slateo/${sha}/snapshot.png`),
    ).toEqual(expected);
  });
  it.each([
    "http://github.com/a/b/blob/main/a.png",
    "https://github.com.evil.test/a/b/blob/main/a.png",
    "https://user@github.com/a/b/blob/main/a.png",
    "https://github.com/a/b/blob/main/a.svg",
    "https://github.com/a/b/blob/main/a%2Fb.png",
    "https://github.com/user-attachments/assets/123",
  ])("does not authenticate unsupported URLs: %s", (url) => {
    expect(parseGitHubImageUrl(url)).toBeNull();
  });
});
