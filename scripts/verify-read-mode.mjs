/**
 * Checks for the `read:` address-bar prefix (src/read-mode.ts).
 *
 * The prefix is the plugin's version of Edge's read: — type `read:host/path`
 * and the page opens as a Markdown note. The contract that matters: the marker
 * is produced for real http(s) targets only, it round-trips back to a clean
 * URL, and it never appears outside the plugin's own control flow.
 *
 * Usage: node scripts/verify-read-mode.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import esbuild from "esbuild";

const require = createRequire(import.meta.url);

const build = await esbuild.build({
  entryPoints: ["src/read-mode.ts"],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2019",
  write: false,
  logLevel: "warning"
});
const tmpFile = path.resolve(".tmp-read-mode-bundle.cjs");
fs.writeFileSync(tmpFile, build.outputFiles[0].text, "utf8");
const readMode = require(tmpFile);

let failures = 0;
const report = [];
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  report.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
};

// A stand-in for the plugin's own address normaliser: bare hosts become
// https, anything else becomes a search URL — exactly like normalizeInput.
const resolve = (target) => {
  if (!target) return "https://www.bing.com/";
  if (/^https?:\/\//i.test(target)) return target;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(target)) return `https://${target}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(target)}`;
};

check("no prefix leaves the address untouched", readMode.stripReadPrefix("example.com") === null);

// Regression guard: the host's normaliser feeds targets back through
// resolveReadRequest (normalizeInput -> resolveReadRequest -> normalizeInput).
// If the resolver ever runs for a non-read address, that wiring recurses until
// the stack blows and every NoteWeb navigation dies.
let resolverRuns = 0;
const guarded = readMode.resolveReadRequest("example.com", () => {
  resolverRuns += 1;
  return "https://example.com/";
});
check(
  "non-read input never invokes the resolver",
  guarded.readRequested === false && guarded.url === "" && guarded.marker === "" && resolverRuns === 0,
  `runs=${resolverRuns}`
);
// A faithful stand-in for normalizeInput: same read: wiring, same fall-through
// resolution (protocol check, bare-host https, search fallback).
const circularResolve = (target) => {
  const value = String(target ?? "").trim();
  const request = readMode.resolveReadRequest(value, circularResolve);
  if (request.readRequested) return request.marker;
  if (request.url) return request.url;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(value)) return `https://${value}`;
  return value ? `https://www.bing.com/search?q=${encodeURIComponent(value)}` : "https://www.bing.com/";
};
check(
  "circular host wiring terminates on a plain address",
  circularResolve("example.com/post") === "https://example.com/post"
);
check(
  "circular host wiring terminates on a bare read:",
  circularResolve("read:") === "https://www.bing.com/"
);

const bare = readMode.resolveReadRequest("read:example.com/post", resolve);
check("read:host resolves and requests the reader", bare.readRequested, bare.marker);
check("read:host marks the resolved https URL", bare.url === "https://example.com/post", bare.url);
check("read:host round-trips to a clean URL", readMode.readModeTarget(bare.marker) === "https://example.com/post");

const full = readMode.resolveReadRequest("read:https://a.example.com/x?y=1&z=2", resolve);
check(
  "read:<full url> keeps query parameters",
  readMode.readModeTarget(full.marker) === "https://a.example.com/x?y=1&z=2",
  readMode.readModeTarget(full.marker)
);

check("full-width colon works (read：)", readMode.stripReadPrefix("read：example.com") === "example.com");
check("uppercase works (READ:)", readMode.stripReadPrefix("READ: example.com") === "example.com");
check("a space after the colon is optional", readMode.stripReadPrefix("read:example.com") === "example.com");
check("a space before the colon works (read : )", readMode.stripReadPrefix("read : example.com") === "example.com");

check("a search phrase still searches", readMode.stripReadPrefix("read:量子计算") === "量子计算");
const phrase = readMode.resolveReadRequest("read:量子计算", resolve);
check(
  "a search phrase behind read: marks the search page",
  phrase.readRequested && /bing\.com\/search/.test(readMode.readModeTarget(phrase.marker)),
  readMode.readModeTarget(phrase.marker)
);

const empty = readMode.resolveReadRequest("read:", resolve);
check("a bare read: is not a request", empty.readRequested === false);
check("a bare read: falls back to home rather than a broken address", empty.url === "https://www.bing.com/", empty.url);

check("the marker scheme is private", readMode.READ_MODE_SCHEME === "mwv-read://");
check("isReadModeUrl only matches the marker", readMode.isReadModeUrl("mwv-read://x") && !readMode.isReadModeUrl("https://x"));
check("readModeTarget on a normal URL is empty", readMode.readModeTarget("https://example.com") === "");
check("readModeTarget survives a malformed escape", readMode.readModeTarget("mwv-read://%E0%A4%A") === "%E0%A4%A");

// The marker must never leak into an address the plugin shows or stores.
const leak = readMode.resolveReadRequest("read:example.com", resolve);
check("the clean URL never contains the marker", !leak.url.includes("mwv-read://"), leak.url);

fs.rmSync(tmpFile, { force: true });
console.log(report.join("\n"));
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
