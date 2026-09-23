/**
 * Bundles the guest-side reader script (src/reader-live-entry.js) into a
 * single expression string, because Electron's `webview.executeJavaScript`
 * can only take source text — it cannot import anything.
 *
 * Output: src/reader-live.generated.ts
 * Run via `npm run build:reader-live` (also wired into `npm run build`).
 */
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const entry = "src/reader-live-entry.js";
const outFile = "src/reader-live.generated.ts";

const result = await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome100", "firefox100", "safari15"],
  minify: true,
  legalComments: "none",
  write: false
});

const code = result.outputFiles[0].text;
if (!/__mwvReadLive/.test(code)) {
  throw new Error("bundled reader script does not define __mwvReadLive");
}

const banner = [
  "/*",
  " * GENERATED FILE - do not edit by hand.",
  " * Source: src/reader-live-entry.js",
  " * Rebuild with: npm run build:reader-live",
  " */",
  ""
].join("\n");

fs.writeFileSync(
  outFile,
  `${banner}export const READER_LIVE_SCRIPT = ${JSON.stringify(code)};\n`,
  "utf8"
);

const bytes = Buffer.byteLength(code, "utf8");
console.log(
  `reader-live bundle: ${bytes} bytes (${(bytes / 1024).toFixed(1)} KB) -> ${path.resolve(outFile)}`
);
