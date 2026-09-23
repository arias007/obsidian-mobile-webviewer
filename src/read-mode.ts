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
 */
export function resolveReadRequest(
  input: string,
  resolve: (target: string) => string
): { readRequested: boolean; url: string; marker: string } {
  const target = stripReadPrefix(input);
  if (target === null) {
    const url = resolve(input);
    return { readRequested: false, url, marker: url };
  }
  if (!target) {
    // "read:" on its own is not a request for anything; fall back to the home
    // page rather than opening a broken address.
    const url = resolve("");
    return { readRequested: false, url, marker: url };
  }
  const resolved = resolve(target);
  if (!/^https?:\/\//i.test(resolved)) {
    return { readRequested: false, url: resolved, marker: resolved };
  }
  return { readRequested: true, url: resolved, marker: buildReadModeUrl(resolved) };
}
