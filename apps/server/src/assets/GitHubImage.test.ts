// @effect-diagnostics nodeBuiltinImport:off - temporary native cache fixtures.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { resolveGitHubImage } from "./GitHubImage.ts";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((path) => NodeFSP.rm(path, { recursive: true, force: true })),
  );
});
const url = "https://github.com/slateo/slateo/blob/main/proof.png?raw=true";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZAAAAABJRU5ErkJggg==",
  "base64",
);
async function cache() {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-github-image-"));
  dirs.push(dir);
  return dir;
}
it("deduplicates downloads, caches bytes, and preserves earlier signed files across refresh", async () => {
  const dir = await cache();
  const download = vi.fn(async () => png);
  const paths = await Promise.all([
    resolveGitHubImage(url, dir, 0, download),
    resolveGitHubImage(url, dir, 0, download),
  ]);
  expect(paths[0]).toBe(paths[1]);
  expect(download).toHaveBeenCalledTimes(1);
  expect(download).toHaveBeenCalledWith("repos/slateo/slateo/contents/proof.png?ref=main");
  expect(await NodeFSP.readFile(paths[0]!)).toEqual(png);
  await resolveGitHubImage(url, dir, 1000, download);
  expect(download).toHaveBeenCalledTimes(1);
  const refreshed = await resolveGitHubImage(url, dir, 3_600_000, download);
  expect(refreshed).not.toBe(paths[0]);
  expect(await NodeFSP.readFile(paths[0]!)).toEqual(png);
});
it("rejects non-images and unrelated hosts without caching them", async () => {
  const dir = await cache();
  const download = vi.fn(async () => Buffer.from("<html>Login</html>"));
  await expect(resolveGitHubImage(url, dir, 0, download)).rejects.toThrow("supported image");
  await expect(resolveGitHubImage("https://example.com/a.png", dir, 0, download)).rejects.toThrow(
    "Unsupported",
  );
  expect(download).toHaveBeenCalledTimes(1);
});
