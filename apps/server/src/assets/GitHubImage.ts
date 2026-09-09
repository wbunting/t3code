// @effect-diagnostics nodeBuiltinImport:off - GitHub CLI output and atomic cache writes are isolated at this native I/O boundary.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { parseGitHubImageUrl } from "@t3tools/shared/githubImage";
import { readImageDimensions } from "@t3tools/shared/imageDimensions";

const execute = NodeUtil.promisify(NodeChildProcess.execFile);
const pending = new Map<string, Promise<string>>();
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Credentials stay in gh; clients receive only an ordinary signed T3 asset URL. */
async function readGitHubImage(endpoint: string) {
  const read = async (apiPath: string) => {
    const { stdout } = await execute("gh", ["api", "--hostname", "github.com", apiPath], {
      encoding: "utf8",
      maxBuffer: Math.ceil(MAX_IMAGE_BYTES * 1.5),
      timeout: 30_000,
    });
    return JSON.parse(stdout) as {
      encoding?: string;
      content?: string;
      size?: number;
      sha?: string;
    };
  };
  let result = await read(endpoint);
  if (typeof result.size !== "number" || result.size > MAX_IMAGE_BYTES) {
    throw new Error("GitHub image exceeds the size limit");
  }
  // The contents API omits bytes above 1 MB; its immutable blob supports these images.
  if (result.encoding === "none" && result.sha && /^[0-9a-f]{40}$/i.test(result.sha)) {
    result = await read(`${endpoint.split("/contents/")[0]}/git/blobs/${result.sha}`);
  }
  if (result.encoding !== "base64" || typeof result.content !== "string") {
    throw new Error("GitHub did not return image contents");
  }
  return Buffer.from(result.content, "base64");
}

export async function resolveGitHubImage(
  url: string,
  cacheDir: string,
  now: number,
  readImage: (endpoint: string) => Promise<Buffer> = readGitHubImage,
): Promise<string> {
  const parsed = parseGitHubImageUrl(url);
  if (!parsed) throw new Error("Unsupported GitHub repository image URL");
  const path = NodePath.join(
    cacheDir,
    NodeCrypto.createHash("sha256")
      .update(parsed.endpoint + (parsed.immutable ? "" : Math.floor(now / 3_600_000)))
      .digest("hex") + parsed.extension,
  );
  const cached = await NodeFSP.stat(path).catch(() => null);
  if (cached) return path;
  const existing = pending.get(path);
  if (existing) return existing;
  const load = (async () => {
    const stdout = await readImage(parsed.endpoint);
    if (stdout.byteLength > MAX_IMAGE_BYTES || !readImageDimensions(stdout)) {
      throw new Error("GitHub did not return a supported image within the size limit");
    }
    await NodeFSP.mkdir(cacheDir, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${NodeCrypto.randomUUID()}.tmp`;
    await NodeFSP.writeFile(temporary, stdout, { mode: 0o600 });
    await NodeFSP.rename(temporary, path);
    return path;
  })();
  pending.set(path, load);
  try {
    return await load;
  } finally {
    pending.delete(path);
  }
}
