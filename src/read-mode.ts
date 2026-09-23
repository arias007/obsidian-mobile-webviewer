/**
 * Edge's `read:` prefix, ported to the plugin.
 *
 * Typing `read:example.com/post` into the address bar — or pasting it — asks
 * for the *reader*: the page opens as a Markdown note in NoteWeb instead of the
 * full browser surface.
 *
 * The prefix is an instruction to the plugin and never part of the address, so
 * it travels on a private scheme (`mwv-read://`) that every entry point strips
 * before a URL reaches the webview, the tab records, the history or the
 * persisted settings. Keeping that resolution in one small module is what makes
 * it testable without booting Obsidian.
 */

export const READ_MODE_SCHEME = "mwv-read://";

/** `read:`, `read：` (full-width) and `read :` all mean the same thing. */
const READ_PREFIX_PATTERN = /^read\s*[:：]\s*/i;

/**
 * Returns the requested target, or null when there is no `read:` prefix.
 * An empty string means the user typed the prefix and nothing else.
 */
export function stripReadPrefix(input: string): string | null {
  const value = (input ?? "").trim();
  const match = READ_PREFIX_PATTERN.exec(value);
  if (!match) return null;
  return value.slice(match[0].length).trim();
}

export function buildReadModeUrl(target: string): string {
  return `${READ_MODE_SCHEME}${encodeURIComponent(target)}`;
}

export function isReadModeUrl(url: string | undefined | null): boolean {
  return typeof url === "string" && url.trim().toLowerCase().startsWith(READ_MODE_SCHEME);
}

/** The real address behind a read-mode marker; empty for anything else. */
export function readModeTarget(url: string | undefined | null): string {
  if (!isReadModeUrl(url)) return "";
  const raw = (url as string).trim().slice(READ_MODE_SCHEME.length);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * One-stop resolution for an address-bar value: applies the `read:` prefix and
 * hands back both the marker and the clean URL. `resolve` is the host's own
 * address normaliser, so a bare host, a search phrase and a full URL all keep
 * behaving exactly as they do without the prefix.
 *
 * The resolver runs ONLY for read-prefixed input. A plain address is reported
 * back with empty url/marker so the caller resolves it through its normal
 * path — feeding it through `resolve` here used to recurse forever when the
 * host's normaliser itself called resolveReadRequest.
 */
export function resolveReadRequest(
  input: string,
  resolve: (target: string) => string
): { readRequested: boolean; url: string; marker: string } {
  const target = stripReadPrefix(input);
  if (target === null) {
    // Not a read request: the caller owns this address.
    return { readRequested: false, url: "", marker: "" };
  }
  if (!target) {
    // "read:" on its own is not a request for anything; fall back to the home
    // page rather than opening a broken address.
    const url = resolve("");
    return { readRequested: false, url, marker: url };
  }
  const resolved = resolve(target);
  if (!/^https?:\/\//i.test(resolved)) {
    // A bare host became https, a phrase became a search URL: still a normal
    // address, only the resolver already produced it (prefix stripped).
    return { readRequested: false, url: resolved, marker: resolved };
  }
  return { readRequested: true, url: resolved, marker: buildReadModeUrl(resolved) };
}
