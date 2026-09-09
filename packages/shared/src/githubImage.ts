/** Parse repository image links without allowing arbitrary authenticated fetches. */
export function parseGitHubImageUrl(input: string) {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const parts = url.pathname.split("/").slice(1).map(decodeURIComponent);
    const [owner, repository] = parts;
    const offset =
      url.hostname === "github.com" && parts[2] === "blob"
        ? 3
        : url.hostname === "raw.githubusercontent.com"
          ? 2
          : null;
    if (
      offset === null ||
      !owner ||
      !repository ||
      !/^[\w.-]+$/.test(owner) ||
      !/^[\w.-]+$/.test(repository)
    )
      return null;
    const ref = parts[offset];
    const path = parts.slice(offset + 1);
    if (
      !ref ||
      !path.length ||
      path.some(
        (part) =>
          !part || part === "." || part === ".." || /[\\/]/.test(part) || part.includes("\0"),
      )
    )
      return null;
    const extension = path
      .at(-1)
      ?.match(/\.(png|jpe?g|gif|webp)$/i)?.[0]
      .toLowerCase();
    if (!extension || [owner, repository].some((part) => part === "." || part === ".."))
      return null;
    return {
      endpoint: `repos/${owner}/${repository}/contents/${path.map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
      extension,
      immutable: /^[0-9a-f]{40}$/i.test(ref),
    };
  } catch {
    return null;
  }
}
