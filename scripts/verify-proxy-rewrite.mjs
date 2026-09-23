/**
 * Proxy document rewrite + release guideline checks.
 *
 * Two separate things are verified here.
 *
 * 1. Behaviour. `rewriteProxyHtml`, `buildProxyInjectedMarkup`,
 *    `injectProxyRuntimeMarkup` and `escapeInlineBlockContent` are extracted
 *    from main.ts, compiled with esbuild to strip the TypeScript annotations,
 *    and run against jsdom's DOMParser. The host runtime that a sandboxed
 *    cross-origin `srcdoc` frame depends on must still land in the document, in
 *    the original order, ahead of `</head>`.
 *
 * 2. Guidelines. The community directory review reads the shipped bundle and
 *    reports a runtime script-element creation as an error, which blocks
 *    installation from within the app. That is a static check over the built
 *    file, so a regression here is invisible at runtime and expensive to
 *    discover — it is asserted against main.js after the build instead.
 *
 * Run: node scripts/verify-proxy-rewrite.mjs
 */
import fs from "node:fs";
import { JSDOM } from "jsdom";
import * as esbuild from "esbuild";

const sourcePath = process.env.MWV_SOURCE || "main.ts";
const bundlePath = process.env.MWV_BUNDLE || "main.js";
const source = fs.readFileSync(sourcePath, "utf8");

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail && !ok ? ` — ${detail}` : ""}`);
}

/* ------------------------------------------------------------------ *
 * Extract real method bodies from the TypeScript source
 * ------------------------------------------------------------------ */

function findBodyEnd(src, braceStart) {
  let depth = 0;
  let i = braceStart;
  let mode = "code";
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && n === "*") { mode = "block"; i += 2; continue; }
      if (c === "'") { mode = "sq"; i++; continue; }
      if (c === '"') { mode = "dq"; i++; continue; }
      if (c === "`") { mode = "tpl"; i++; continue; }
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) return i; }
      i++;
      continue;
    }
    if (mode === "line") { if (c === "\n") mode = "code"; i++; continue; }
    if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i += 2; continue; } i++; continue; }
    if (mode === "sq" || mode === "dq") {
      const q = mode === "sq" ? "'" : '"';
      if (c === "\\") { i += 2; continue; }
      if (c === q) mode = "code";
      i++;
      continue;
    }
    if (mode === "tpl") {
      if (c === "\\") { i += 2; continue; }
      if (c === "`") mode = "code";
      i++;
      continue;
    }
  }
  throw new Error("unterminated body");
}

function extractMethod(src, name) {
  const re = new RegExp(`^  (?:private |public |protected )?(async )?${name}\\s*\\(`, "m");
  const m = re.exec(src);
  if (!m) throw new Error(`method not found: ${name}`);
  const parenStart = src.indexOf("(", m.index);
  const braceStart = src.indexOf("{", parenStart);
  const end = findBodyEnd(src, braceStart);
  return { isAsync: Boolean(m[1]), paramsAndBody: src.slice(parenStart, end + 1) };
}

function extractTopLevelFunction(src, name) {
  const re = new RegExp(`^function ${name}\\s*\\(`, "m");
  const m = re.exec(src);
  if (!m) throw new Error(`top-level function not found: ${name}`);
  const end = findBodyEnd(src, src.indexOf("{", src.indexOf("(", m.index)));
  return src.slice(m.index, end + 1);
}

function toJs(ts) {
  return esbuild.transformSync(ts, { loader: "ts", format: "cjs", target: "es2020" }).code;
}

function buildProxyTable(src) {
  const escapeJs = toJs(extractTopLevelFunction(src, "escapeInlineBlockContent"));
  const injectJs = toJs(extractTopLevelFunction(src, "injectProxyRuntimeMarkup"));
  const entries = ["buildProxyInjectedMarkup", "rewriteProxyHtml"].map((name) => {
    const { isAsync, paramsAndBody } = extractMethod(src, name);
    return `  ${name}: ${isAsync ? "async " : ""}function ${paramsAndBody}`;
  });
  const ts = [
    "const __P = {",
    entries.join(",\n"),
    "  ,buildProxyRuntimeCss: function () { return __stub.css; }",
    "  ,proxySeedScript: function () { return __stub.seed; }",
    "};",
    "__P.injectRaw = injectProxyRuntimeMarkup;",
    "__P;"
  ].join("\n");
  const js = toJs(ts);
  return new Function("DOMParser", "MWV_PROXY_BRIDGE_SOURCE", "__stub", `${escapeJs}\n${injectJs}\n${js}\nreturn __P;`);
}

const dom = new JSDOM("");
const stub = { css: "html{zoom:120%}", seed: "window.__mwvInit = {};" };
const makeProxy = buildProxyTable(source)(dom.window.DOMParser, "(function(){/*bridge*/})();", stub);

/* ------------------------------------------------------------------ *
 * 1. Behaviour: the host runtime still reaches the proxied document
 * ------------------------------------------------------------------ */

const SOURCE_URL = "https://example.com/page";
const RAW_HTML = [
  "<!doctype html><html><head>",
  '<meta http-equiv="Content-Security-Policy" content="frame-ancestors \'none\'">',
  '<meta http-equiv="X-Frame-Options" content="DENY">',
  '<base href="https://stale.example/">',
  '<script src="a.js" integrity="sha256-abc"></script>',
  "<title>Title</title></head><body><a href=\"/x\">x</a></body></html>"
].join("");

const rewritten = makeProxy.rewriteProxyHtml(RAW_HTML, SOURCE_URL);

check(
  "strips the framing headers, the stale base and subresource integrity",
  rewritten.includes(`<base href="${SOURCE_URL}">`) &&
    !rewritten.includes("frame-ancestors") &&
    !/x-frame-options/i.test(rewritten) &&
    !rewritten.includes("stale.example") &&
    !rewritten.includes("integrity")
);

const iStyle = rewritten.indexOf("data-mwv-proxy-runtime");
const iSeed = rewritten.indexOf("data-mwv-proxy-seed");
const iBridge = rewritten.indexOf("data-mwv-proxy-bridge");
const iHeadEnd = rewritten.search(/<\/head\s*>/i);
check(
  "runtime style, seed and bridge land at the end of head in that order",
  iStyle > -1 && iSeed > iStyle && iBridge > iSeed && iHeadEnd > iBridge
);
check(
  "the page body follows the injection",
  rewritten.search(/<body[^>]*>/i) > iHeadEnd
);

const injectedSlice = rewritten.slice(iStyle, iHeadEnd);
check(
  "injected markup carries no src attribute",
  !/\ssrc\s*=/i.test(injectedSlice)
);

// Escaping is measured on a fixture with no script of its own, so the only
// closing tags in the output are the two the host injects.
const BARE_HTML = "<!doctype html><html><head><title>T</title></head><body>hi</body></html>";

stub.seed = 'window.__mwvInit = {"cookies":{"sid":"</script><img src=x>"}};';
const seeded = makeProxy.rewriteProxyHtml(BARE_HTML, SOURCE_URL);
const closingTags = (seeded.match(/<\/script>/gi) || []).length;
check(
  "a payload containing a closing tag cannot break out of its block",
  closingTags === 2 && seeded.includes("<\\/script") && !seeded.includes('"</script>'),
  `closing tags=${closingTags}`
);

stub.seed = "window.__mwvInit = {};";
stub.css = "body{color:red}</style><script>alert(1)</script>";
const styled = makeProxy.rewriteProxyHtml(BARE_HTML, SOURCE_URL);
check(
  "a CSS payload containing a closing tag cannot break out of its block",
  (styled.match(/<\/style>/gi) || []).length === 1
);

const bodyOnly = makeProxy.injectRaw("<html><body>x</body></html>", "<!--m-->");
check(
  "markup is inserted before a body when no head end is present",
  bodyOnly.indexOf("<!--m-->") > -1 && bodyOnly.indexOf("<!--m-->") < bodyOnly.search(/<body[^>]*>/i)
);
check(
  "markup is appended when no insertion point exists at all",
  makeProxy.injectRaw("plain", "<!--m-->").endsWith("<!--m-->")
);

/* ------------------------------------------------------------------ *
 * 2. Guidelines: neither the source nor the shipped bundle may create a
 *    script element at runtime.
 * ------------------------------------------------------------------ */

const CREATION_PATTERNS = [
  /\.createElement\(\s*["'`]script["'`]\s*\)/,
  /\.createElement\(\s*["'`]SCRIPT["'`]\s*\)/
];

function flagIn(text) {
  return CREATION_PATTERNS.filter((re) => re.test(text)).length;
}

check("main.ts contains no runtime script-element creation", flagIn(source) === 0);
check("main.ts contains no script src assignment", !/\bscript\.src\s*=/.test(source));
check(
  "main.ts appends no seed or bridge script node",
  !/\bappendChild\(\s*(seed|bridge)\s*\)/.test(source)
);

if (fs.existsSync(bundlePath)) {
  const bundle = fs.readFileSync(bundlePath, "utf8");
  // Only deterministic patterns are checked on the bundle: minification renames
  // local variables, so an appendChild(variable) probe would be a false alarm.
  check(`${bundlePath} contains no runtime script-element creation`, flagIn(bundle) === 0);
  check(
    `${bundlePath} still ships the proxy runtime markers`,
    bundle.includes("data-mwv-proxy-runtime") &&
      bundle.includes("data-mwv-proxy-seed") &&
      bundle.includes("data-mwv-proxy-bridge")
  );
} else {
  console.log(`SKIP ${bundlePath} not built yet — run npm run build for the bundle guideline checks`);
}

/* ------------------------------------------------------------------ *
 * 3. Release artefacts agree on one version
 * ------------------------------------------------------------------ */

const pkgVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const manifestVersion = JSON.parse(fs.readFileSync("manifest.json", "utf8")).version;
check(`package.json and manifest.json agree on ${pkgVersion}`, pkgVersion === manifestVersion, `${pkgVersion} vs ${manifestVersion}`);
check("styles.css is present for the release", fs.existsSync("styles.css"));

/* ------------------------------------------------------------------ */

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error(`\n${failed.length} of ${results.length} proxy/guideline checks FAILED.`);
  process.exit(1);
}
console.log(`\nProxy rewrite + release guidelines passed (${results.length}/${results.length}).`);
