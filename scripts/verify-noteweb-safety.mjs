/**
 * Behavioural checks for the two phone-only fixes in 0.4.45:
 *
 *  1. NoteDraw autosave must never write an empty draft over stored ink.
 *     Every failure reproduced here happened on a real page: a re-render mounts
 *     a fresh NoteDraw controller (empty draft), a sync pass asks for a save,
 *     and the strokes file was overwritten with `strokes: []`.
 *
 *  2. Two fingers on an active NoteDraw surface must pan the note. The canvas
 *     is `touch-action: none` with `pointer-events: auto`, so before this the
 *     page could not be scrolled at all while the wand was on.
 *
 * The real method bodies are extracted from main.ts, compiled with esbuild and
 * run against jsdom — not asserted against the source text.
 *
 * Run: node scripts/verify-noteweb-safety.mjs
 */
import fs from "node:fs";
import { JSDOM } from "jsdom";
import * as esbuild from "esbuild";

const source = fs.readFileSync(process.env.MWV_SOURCE || "main.ts", "utf8");

/* ------------------------------------------------------------------ *
 * Method extraction (same walker as verify-browser-controls.mjs)
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
  throw new Error("unterminated method body");
}

function extractMethod(src, name) {
  const re = new RegExp(`^  (?:private |public |protected )?(async )?${name}\\s*\\(`, "m");
  const m = re.exec(src);
  if (!m) throw new Error(`method not found: ${name}`);
  const parenStart = src.indexOf("(", m.index);
  const end = findBodyEnd(src, src.indexOf("{", parenStart));
  return { isAsync: Boolean(m[1]), paramsAndBody: src.slice(parenStart, end + 1) };
}

function extractTopLevelFunction(src, name) {
  const re = new RegExp(`^function ${name}\\s*\\(`, "m");
  const m = re.exec(src);
  if (!m) throw new Error(`top-level function not found: ${name}`);
  const end = findBodyEnd(src, src.indexOf("{", src.indexOf("(", m.index)));
  return src.slice(m.index, end + 1);
}

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */
const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
const { window } = dom;
global.window = window;
global.document = window.document;
global.Node = window.Node;
global.DOMParser = window.DOMParser;
global.NodeFilter = window.NodeFilter;
// jsdom ships no PointerEvent; the production fallback path then has to be the
// one under test, so `Event` must be jsdom's class (Node has its own).
global.Event = window.Event;
global.CustomEvent = window.CustomEvent;
global.HTMLElement = window.HTMLElement;
global.Element = window.Element;
global.MutationObserver = window.MutationObserver;

// Obsidian adds these helpers to HTMLElement.prototype.
window.HTMLElement.prototype.hasClass = function (cls) { return this.classList.contains(cls); };
window.HTMLElement.prototype.addClass = function (cls) { this.classList.add(cls); };
window.HTMLElement.prototype.removeClass = function (cls) { this.classList.remove(cls); };
window.HTMLElement.prototype.toggleClass = function (cls, on) { this.classList.toggle(cls, on); };

const METHODS = [
  "noteDrawDrawingIsEmpty",
  "noteDrawDrawingPayload",
  "writeNoteDrawDrawingSafely",
  "flushNoteDrawDrawingNow",
  "queueNoteDrawDrawingSave",
  "installNoteDrawTwoFingerScroll",
  "findScrollableAncestor"
];

const entries = METHODS.map((name) => {
  const extracted = extractMethod(source, name);
  return `  ${name}: ${extracted.isAsync ? "async " : ""}function ${extracted.paramsAndBody}`;
});
const ts = `const __M = {\n${entries.join(",\n")}\n};\n__M;\n`;
const js = esbuild.transformSync(ts, { loader: "ts", format: "cjs", target: "es2020" }).code;
const table = new Function("appDocument", `${js}\nreturn __M;`)(() => window.document);

/* ------------------------------------------------------------------ *
 * 1. Drawing safety
 * ------------------------------------------------------------------ */
const strokes = [{ id: "s1" }, { id: "s2" }];
let store = { strokes: [], webEdits: [], markdownBlocks: [] };
let writes = 0;
const refreshes = [];
let toolMode = "select";

const ctx = {
  noteDrawDrawingReloadAt: new WeakMap(),
  noteDrawDrawingSaveTimers: new WeakMap(),
  isNoteDrawSurfaceElement: () => true,
  getNoteDrawPlugin: () => ({
    writeDrawings: async () => { writes += 1; },
    api: {
      readDrawings: async () => JSON.parse(JSON.stringify(store)),
      refresh: async (file) => { refreshes.push(file?.path ?? "?"); }
    }
  }),
  ...table
};
// The extracted methods call each other through `this`.
for (const name of METHODS) ctx[name] = table[name].bind(ctx);

const surface = window.document.createElement("div");
surface.className = "mwv-embed";
window.document.body.appendChild(surface);

function controller(overrides = {}) {
  return {
    file: { path: "webviews/example.com__1234abcd.md", name: "example.com__1234abcd.md", extension: "md" },
    previewEl: surface,
    drawingsLoaded: true,
    toolMode,
    drawingData: { strokes: [], webEdits: [], markdownBlocks: [] },
    ...overrides
  };
}

const checks = [];
const check = (name, ok) => checks.push([name, ok]);

// -- emptiness predicate
check(
  "an empty draft is recognised as empty",
  ctx.noteDrawDrawingIsEmpty({ strokes: [], webEdits: [], markdownBlocks: [] }) === true
);
check(
  "any stroke, web edit or markdown block makes a draft non-empty",
  ctx.noteDrawDrawingIsEmpty({ strokes: [{}] }) === false &&
    ctx.noteDrawDrawingIsEmpty({ webEdits: [{}] }) === false &&
    ctx.noteDrawDrawingIsEmpty({ markdownBlocks: [{}] }) === false
);

// -- a surface that has not loaded must not write at all
store = { strokes, webEdits: [], markdownBlocks: [] };
writes = 0;
await ctx.writeNoteDrawDrawingSafely(controller({ drawingsLoaded: false }));
check("a not-yet-loaded surface writes nothing", writes === 0);

// -- loaded but emptied-out in memory while the file still has ink
store = { strokes, webEdits: [], markdownBlocks: [] };
writes = 0;
refreshes.length = 0;
await ctx.writeNoteDrawDrawingSafely(controller({ drawingsLoaded: true }));
check("an empty draft never overwrites stored ink", writes === 0);
check("the stored ink is re-applied instead", refreshes.length === 1);

// -- refreshed twice in a row must not hammer NoteDraw (same controller)
const throttled = controller({ drawingsLoaded: true });
refreshes.length = 0;
await ctx.writeNoteDrawDrawingSafely(throttled);
await ctx.writeNoteDrawDrawingSafely(throttled);
check("the refresh is throttled per surface", refreshes.length === 1);

// -- a genuinely empty page may be written (user erased everything)
store = { strokes: [], webEdits: [], markdownBlocks: [] };
writes = 0;
await ctx.writeNoteDrawDrawingSafely(controller({ drawingsLoaded: true }));
check("an empty page still saves its emptiness", writes === 1);

// -- real ink is written straight through
store = { strokes: [], webEdits: [], markdownBlocks: [] };
writes = 0;
const ink = { strokes: [{ id: "a" }], webEdits: [], markdownBlocks: [] };
await ctx.writeNoteDrawDrawingSafely(controller({ drawingData: ink }));
check("real ink is written through", writes === 1);

// -- the immediate flush must not hand an empty draft to NoteDraw's scheduler
store = { strokes, webEdits: [], markdownBlocks: [] };
writes = 0;
let scheduled = 0;
ctx.getNoteDrawPlugin = () => ({
  writeDrawings: async () => { writes += 1; },
  scheduleDrawingSave: () => { scheduled += 1; },
  api: {
    readDrawings: async () => JSON.parse(JSON.stringify(store)),
    refresh: async () => {}
  }
});
await ctx.flushNoteDrawDrawingNow(controller({ drawingsLoaded: false }));
check("flush writes nothing for an unloaded surface", writes === 0 && scheduled === 0);
await ctx.flushNoteDrawDrawingNow(controller({ drawingsLoaded: true }));
check("flush writes nothing when the draft is empty but ink is stored", writes === 0 && scheduled === 0);
await ctx.flushNoteDrawDrawingNow(controller({ drawingsLoaded: true, drawingData: { strokes: [{ id: "x" }], webEdits: [], markdownBlocks: [] } }));
check("flush saves real ink to both paths", writes === 1 && scheduled === 1);
ctx.getNoteDrawPlugin = () => ({
  writeDrawings: async () => { writes += 1; },
  api: {
    readDrawings: async () => JSON.parse(JSON.stringify(store)),
    refresh: async (file) => { refreshes.push(file?.path ?? "?"); }
  }
});

// -- the queued autosave refuses before NoteDraw reports the surface loaded
store = { strokes, webEdits: [], markdownBlocks: [] };
writes = 0;
ctx.queueNoteDrawDrawingSave(controller({ drawingsLoaded: false }));
await new Promise((resolve) => setTimeout(resolve, 1000));
check("the debounced autosave also refuses an unloaded surface", writes === 0);

// -- page identity: the same page must always mean the same ink file
const idMethods = ["noteDrawWebviewIdentity", "noteDrawWebviewLabel", "noteDrawWebviewFileForIdentity", "noteDrawWebviewFileForUrl", "noteDrawLegacyWebviewFileForUrl"];
const idEntries = idMethods.map((name) => {
  const extracted = extractMethod(source, name);
  return `  ${name}: ${extracted.isAsync ? "async " : ""}function${extracted.paramsAndBody}`;
});
const idTs = `const __ID = {\n${idEntries.join(",\n")}\n};\n__ID;\n`;
const idJs = esbuild.transformSync(idTs, { loader: "ts", format: "cjs", target: "es2020" }).code;
const idTable = new Function(`${idJs}\nreturn __ID;`)();
const idCtx = Object.assign({}, idTable);
for (const name of idMethods) idCtx[name] = idTable[name].bind(idCtx);

const a = idCtx.noteDrawWebviewFileForUrl("https://Example.com/post/");
const b = idCtx.noteDrawWebviewFileForUrl("https://example.com/post#section-3");
const c = idCtx.noteDrawWebviewFileForUrl("https://example.com/post");
const d = idCtx.noteDrawWebviewFileForUrl("https://example.com/other");
check("a page keeps one ink file across hash and trailing-slash changes", a.path === b.path && b.path === c.path);
check("a different page still gets its own ink file", a.path !== d.path);
check(
  "the old raw-URL identity is still addressable for migration",
  idCtx.noteDrawLegacyWebviewFileForUrl("https://example.com/post#x").path !== idCtx.noteDrawWebviewFileForUrl("https://example.com/post#x").path
);

// -- migration moves yesterday's ink onto today's identity
let inkStore = {};
const migrated = [];
const migrateCtx = Object.assign({}, idCtx, {
  noteDrawInkMigrationQueued: new WeakSet(),
  noteDrawDrawingIsEmpty: ctx.noteDrawDrawingIsEmpty.bind(ctx),
  settings: { homeUrl: "https://example.com/" },
  getNoteDrawPlugin: () => ({
    api: {
      readDrawings: async (file) => JSON.parse(JSON.stringify(inkStore[file.path] ?? { strokes: [], webEdits: [], markdownBlocks: [] })),
      writeDrawings: async (file, data) => { inkStore[file.path] = JSON.parse(JSON.stringify(data)); migrated.push(file.path); },
      refresh: async () => {}
    }
  })
});
const qMethods = ["queueNoteDrawWebviewInkMigration", "noteDrawWebviewIdentity", "noteDrawWebviewLabel", "noteDrawWebviewFileForIdentity", "noteDrawWebviewFileForUrl", "noteDrawLegacyWebviewFileForUrl"];
const qEntries = qMethods.map((name) => {
  const extracted = extractMethod(source, name);
  return `  ${name}: ${extracted.isAsync ? "async " : ""}function${extracted.paramsAndBody}`;
});
const qTs = `const __Q = {\n${qEntries.join(",\n")}\n};\n__Q;\n`;
const qJs = esbuild.transformSync(qTs, { loader: "ts", format: "cjs", target: "es2020" }).code;
const qTable = new Function(`${qJs}\nreturn __Q;`)();
for (const name of qMethods) migrateCtx[name] = qTable[name].bind(migrateCtx);

const legacyPath = migrateCtx.noteDrawLegacyWebviewFileForUrl("https://example.com/post#x").path;
const canonicalPath = migrateCtx.noteDrawWebviewFileForUrl("https://example.com/post").path;
inkStore[legacyPath] = { strokes: [{ id: "old" }], webEdits: [], markdownBlocks: [] };
const migSurface = window.document.createElement("div");
window.document.body.appendChild(migSurface);
migrateCtx.queueNoteDrawWebviewInkMigration(migSurface, "https://example.com/post#x");
await new Promise((resolve) => setTimeout(resolve, 30));
check("ink stored under the old identity is carried over", migrated.includes(canonicalPath) && (inkStore[canonicalPath]?.strokes?.length ?? 0) === 1);
check("the migrated ink points at the new file", inkStore[canonicalPath]?.sourcePath === canonicalPath);

// A second pass must not fight over a file that already has ink.
migrated.length = 0;
inkStore[legacyPath] = { strokes: [], webEdits: [], markdownBlocks: [] };
const migSurface2 = window.document.createElement("div");
window.document.body.appendChild(migSurface2);
migrateCtx.queueNoteDrawWebviewInkMigration(migSurface2, "https://example.com/post");
await new Promise((resolve) => setTimeout(resolve, 30));
check("a page whose ink is already on the new identity is left alone", migrated.length === 0);

/* ------------------------------------------------------------------ *
 * 2. Two-finger pan
 * ------------------------------------------------------------------ */
// A note body that scrolls, an active NoteDraw shell, and its canvas.
const scroller = window.document.createElement("div");
scroller.className = "markdown-preview-view";
scroller.style.overflowY = "auto";
Object.defineProperty(scroller, "scrollHeight", { value: 2000, configurable: true });
Object.defineProperty(scroller, "clientHeight", { value: 600, configurable: true });
scroller.scrollTop = 0;
const embed = window.document.createElement("div");
embed.className = "mwv-embed is-drawing-active notedraw-shell";
const canvas = window.document.createElement("canvas");
canvas.className = "notedraw-canvas";
// The bridge keys off the canvas actually swallowing touches, so the fixture has
// to declare that: `pointer-events: none` means the page still scrolls natively.
canvas.style.pointerEvents = "auto";
embed.appendChild(canvas);
scroller.appendChild(embed);
window.document.body.appendChild(scroller);

const listeners = new Map();
const scrollCtx = {
  register: () => {},
  registerDomEvent: (target, type, handler) => {
    const list = listeners.get(type) ?? [];
    list.push(handler);
    listeners.set(type, list);
  },
  findWebviewNoteDrawController: () => ({ toolMode }),
  ...table,
  findScrollableAncestor: table.findScrollableAncestor.bind({
    registerDomEvent: () => {},
    ...table
  })
};
for (const name of ["installNoteDrawTwoFingerScroll", "findScrollableAncestor"]) {
  scrollCtx[name] = table[name].bind(scrollCtx);
}
scrollCtx.installNoteDrawTwoFingerScroll();

function touch(type, ys, target = canvas) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: ys.map((clientY) => ({ clientY, clientX: 10 }))
  });
  target.dispatchEvent(event);
  return event;
}
function fire(type, ys, target = canvas) {
  for (const handler of listeners.get(type) ?? []) handler(touch(type, ys, target));
}

// Single finger does nothing (it is a drawing/select gesture).
toolMode = "select";
scroller.scrollTop = 0;
fire("touchstart", [100]);
fire("touchmove", [60]);
check("one finger never pans the page", scroller.scrollTop === 0);

// Two fingers pan, and the gesture is claimed from the canvas.
toolMode = "select";
scroller.scrollTop = 200;
fire("touchstart", [200, 300]);
const moveEvent = touch("touchmove", [170, 270]);
let defaultPrevented = false;
for (const handler of listeners.get("touchmove") ?? []) {
  defaultPrevented = false;
  handler(Object.assign(moveEvent, { preventDefault: () => { defaultPrevented = true; } }));
}
check("two fingers scroll the note", scroller.scrollTop === 230);
check("the pan is claimed before the drawing canvas sees it", defaultPrevented === true);
fire("touchend", []);

// The pen draws with one finger; two fingers still pan, and the half-drawn
// stroke is cancelled so the page moves without leaving a mark behind.
toolMode = "draw";
const drawCancelled = [];
const drawTarget = window.document.createElement("div");
embed.appendChild(drawTarget);
drawTarget.addEventListener("pointercancel", (event) => drawCancelled.push(event.pointerId));
for (const handler of listeners.get("pointerdown") ?? []) {
  handler({ pointerType: "touch", pointerId: 11, target: drawTarget });
}
scroller.scrollTop = 200;
fire("touchstart", [200, 300]);
fire("touchmove", [150, 250]);
check("drawing mode pans with two fingers too", scroller.scrollTop === 250);
check("the pen stroke is cancelled when the pan takes over", drawCancelled.includes(11));
for (const handler of listeners.get("touchend") ?? []) {
  const event = new window.Event("touchend", { bubbles: true });
  Object.defineProperty(event, "touches", { value: [] });
  handler(event);
}

// A surface without the wand (canvas ignores pointers) scrolls natively: the
// bridge must stay out of the way so the browser's own momentum keeps working.
toolMode = "select";
canvas.style.pointerEvents = "none";
scroller.scrollTop = 200;
fire("touchstart", [200, 300]);
fire("touchmove", [150, 250]);
check("an inactive surface keeps native scrolling", scroller.scrollTop === 200);

// Taking over the gesture must cancel the stroke NoteDraw had begun and mute
// the canvas, otherwise the pan leaves a stray mark behind.
canvas.style.pointerEvents = "auto";
toolMode = "select";
const cancelled = [];
const pointerTarget = window.document.createElement("div");
embed.appendChild(pointerTarget);
pointerTarget.addEventListener("pointercancel", (event) => cancelled.push(event.pointerId));
for (const handler of listeners.get("pointerdown") ?? []) {
  handler({ pointerType: "touch", pointerId: 7, target: pointerTarget });
}
scroller.scrollTop = 200;
fire("touchstart", [200, 300]);
fire("touchmove", [180, 280]);
check("a pan cancels the drawing gesture already in flight", cancelled.includes(7));
check("the canvas is muted while panning", canvas.style.pointerEvents === "none");
// touchend still reports the fingers that remain: none.
for (const handler of listeners.get("touchend") ?? []) {
  const event = new window.Event("touchend", { bubbles: true });
  Object.defineProperty(event, "touches", { value: [] });
  handler(event);
}
check("the canvas is restored when the pan ends", canvas.style.pointerEvents === "");

/* ------------------------------------------------------------------ *
 * 3. Markdown export keeps the page's shape  (存 MD 原样)
 * ------------------------------------------------------------------ */
const build = await esbuild.build({
  entryPoints: ["src/reader.ts"],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2019",
  write: false,
  logLevel: "warning"
});
const readerModule = new Function("module", "exports", "require", build.outputFiles[0].text);
const readerExports = { exports: {} };
readerModule(readerExports, readerExports.exports, () => ({}));
const { htmlToMarkdown } = readerExports.exports;

const helpers = {
  hostName: (url) => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return String(url); }
  },
  escapeMarkdownText: (value) => value.replace(/\r/g, "").replace(/\u00a0/g, " ").trim(),
  htmlToText: (value) => value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
  htmlToMarkdown
};
const exportSource = esbuild.transformSync(
  [extractTopLevelFunction(source, "webNoteMarkdown")].join("\n"),
  { loader: "ts", format: "cjs", target: "es2020" }
).code;
const exportFn = new Function(
  "hostName", "escapeMarkdownText", "htmlToText", "htmlToMarkdown",
  `${exportSource}\nreturn webNoteMarkdown;`
)(helpers.hostName, helpers.escapeMarkdownText, helpers.htmlToText, htmlToMarkdown);

const ORIGINAL = [
  "## 一、章",
  "",
  "普通段落，含 **加粗** 与 [链接](https://example.com/a)。",
  "",
  "| 命令 | 作用 |",
  "| --- | --- |",
  "| `ls` | 列目录 |",
  "",
  "- [ ] 待办",
  "",
  "```sh",
  "ls -lh",
  "```",
  "",
  "![图](https://example.com/a.png)"
].join("\n");

const untouched = exportFn({
  id: "n1",
  url: "https://example.com/post",
  title: "示例",
  sourceTitle: "示例",
  noteHtml: "<h2>旧快照</h2>",
  noteText: "旧快照",
  noteMarkdown: ORIGINAL,
  doodleSvg: "",
  pageHtml: "",
  pageText: "",
  pageEdits: [],
  markdownPath: "",
  updatedAt: Date.parse("2026-10-26T00:00:00Z"),
  createdAt: 0
});
check("an untouched note exports its Markdown verbatim", untouched.includes(ORIGINAL));

// The edited path converts the DOM; the page shape has to survive.
const rendered = htmlToMarkdown(
  `<h2>一、章</h2><p>普通段落，含 <strong>加粗</strong> 与 <a href="https://example.com/a">链接</a>。</p>` +
    `<table><thead><tr><th>命令</th><th>作用</th></tr></thead><tbody><tr><td><code>ls</code></td><td>列目录</td></tr></tbody></table>` +
    `<ul><li><input type="checkbox"> 待办</li></ul>` +
    `<pre><code class="language-sh">ls -lh</code></pre>` +
    `<p><img src="https://example.com/a.png" alt="图"></p>`,
  "https://example.com/post"
);
const edited = exportFn({
  id: "n2",
  url: "https://example.com/post",
  title: "示例",
  sourceTitle: "示例",
  noteHtml: "",
  noteText: "",
  noteMarkdown: "",
  doodleSvg: "",
  pageHtml: "",
  pageText: "",
  pageEdits: [],
  markdownPath: "",
  updatedAt: Date.parse("2026-10-26T00:00:00Z"),
  createdAt: 0
});
// Feed the converted HTML through noteHtml to exercise the edited path.
const editedExport = exportFn({
  id: "n3",
  url: "https://example.com/post",
  title: "示例",
  sourceTitle: "示例",
  noteHtml: `<h2>一、章</h2><p>普通段落，含 <strong>加粗</strong> 与 <a href="https://example.com/a">链接</a>。</p>` +
    `<table><thead><tr><th>命令</th><th>作用</th></tr></thead><tbody><tr><td><code>ls</code></td><td>列目录</td></tr></tbody></table>` +
    `<ul><li><input type="checkbox"> 待办</li></ul>` +
    `<pre><code class="language-sh">ls -lh</code></pre>` +
    `<p><img src="https://example.com/a.png" alt="图"></p>`,
  noteText: "",
  noteMarkdown: "",
  doodleSvg: "",
  pageHtml: "",
  pageText: "",
  pageEdits: [],
  markdownPath: "",
  updatedAt: Date.parse("2026-10-26T00:00:00Z"),
  createdAt: 0
});
for (const [label, needle] of [
  ["headings", "## 一、章"],
  ["bold", "**加粗**"],
  ["links", "[链接](https://example.com/a)"],
  ["GFM tables", "| 命令 | 作用 |"],
  ["task lists", "- [ ] 待办"],
  ["fenced code", "```sh"],
  ["images", "![图](https://example.com/a.png)"]
]) {
  check(`an edited note keeps ${label} when saved`, editedExport.includes(needle));
}
check("edited export never falls back to flattened text", !editedExport.includes("<p>") && editedExport.includes("## 一、章"));
void edited;
void rendered;

/* ------------------------------------------------------------------ *
 * 4. 存 MD actually lands in the vault
 * ------------------------------------------------------------------ */
class FakeTFile { constructor(path) { this.path = path; } }
const vaultFiles = new Map();
const vaultCalls = { create: 0, modify: 0, createFolder: 0 };
const folders = new Set();
const fakeVault = {
  getAbstractFileByPath: (path) => {
    if (vaultFiles.has(path)) return new FakeTFile(path);
    if (folders.has(path)) return { path, kind: "folder" };
    return null;
  },
  create: async (path, data) => {
    vaultCalls.create += 1;
    vaultFiles.set(path, data);
    return new FakeTFile(path);
  },
  modify: async (file, data) => {
    vaultCalls.modify += 1;
    vaultFiles.set(file.path, data);
    return file;
  },
  createFolder: async (path) => {
    vaultCalls.createFolder += 1;
    folders.add(path);
    return { path };
  }
};

const exportMethods = ["exportWebNoteMarkdown", "ensureVaultFolder", "findWebNoteByUrl", "noteDrawWebviewIdentity", "exportEmbedWebNote",
  "readWebNoteInk", "writeWebNoteInk", "rebaseLegacyNoteDrawStroke",
  "noteDrawDrawingIsEmpty", "noteDrawWebviewFileForUrl", "noteDrawWebviewFileForIdentity", "noteDrawWebviewLabel",
  "noteDrawWebviewIdentity", "getNoteDrawPlugin"];
const exportEntries = exportMethods.map((name) => {
  const extracted = extractMethod(source, name);
  return `  ${name}: ${extracted.isAsync ? "async " : ""}function${extracted.paramsAndBody}`;
});
const exportTs = `const __E = {\n${exportEntries.join(",\n")}\n};\n__E;\n`;
const exportJs = esbuild.transformSync(exportTs, { loader: "ts", format: "cjs", target: "es2020" }).code;
const exportTable = new Function("webNoteId", "hostName", "sanitizeFileName", "appendFileExtension", "normalizePath", "TFile", "webNoteMarkdown", "htmlToMarkdownFromElement", "WebNoteEntry", "Notice",
  `${exportJs}\nreturn __E;`)(
  (url) => `webnote-${url}`,
  helpers.hostName,
  (name) => name.replace(/[\\/:*?"<>|]/g, "-"),
  (name, ext) => `${name}.${ext}`,
  (p) => p.replace(/^\/+|\/+$/g, ""),
  FakeTFile,
  exportFn,
  (el) => el.innerHTML,
  undefined,
  function Notice() {}
);

const exportCtx = Object.assign({}, exportTable, {
  settings: { webNoteFolder: "Mobile Webviewer Notes", webNotes: [] },
  app: { vault: fakeVault },
  addConsole: async () => {},
  saveWebNote: async (entry) => {
    exportCtx.settings.webNotes = [entry, ...exportCtx.settings.webNotes.filter((e) => e.id !== entry.id)];
    return entry;
  },
  uniqueVaultPath: async (folder, fileName) => `${folder}/${fileName}`,
  tr: (key) => key,
  Notice: function Notice() {},
  createWebNoteFromPage: (page) => ({
    id: `note-${page.url}`, url: page.url, title: page.title, sourceTitle: page.title,
    noteHtml: "", noteText: "", noteMarkdown: "", doodleSvg: "", pageHtml: "", pageText: "",
    pageEdits: [], markdownPath: "", updatedAt: 0, createdAt: 0
  }),
  htmlToMarkdownFromElement: (el) => el.innerHTML
});
for (const name of exportMethods) exportCtx[name] = exportTable[name].bind(exportCtx);

// NoteDraw stands in for the real plugin: drawings are keyed by file path, and
// every write is kept so the test can prove what the note received.
const noteInk = new Map();
const noteDrawStub = {
  api: {
    readDrawings: async (file) => {
      const stored = noteInk.get(file?.path);
      return stored ? JSON.parse(JSON.stringify(stored)) : null;
    },
    writeDrawings: async (file, data) => {
      noteInk.set(file.path, JSON.parse(JSON.stringify(data)));
      return data;
    },
    refresh: async () => ({ ok: true })
  }
};
exportCtx.getNoteDrawPlugin = () => noteDrawStub;
exportCtx.findWebviewNoteDrawController = () => null;
// Same contracts as the plugin, kept here because their object return types
// defeat the source extractor (`findBodyEnd` stops at the type literal).
exportCtx.noteDrawDataCounts = (data) => {
  const strokes = Array.isArray(data?.strokes) ? data.strokes.length : 0;
  const webEdits = Array.isArray(data?.webEdits) ? data.webEdits.length : 0;
  return { strokes, webEdits, total: strokes + webEdits };
};
exportCtx.noteDrawDataHasForeignAnchors = (data, path) => (data?.strokes ?? []).some((stroke) => {
  const corners = Object.values(stroke?.layout?.corners ?? {});
  return corners.some((corner) => corner?.path !== path) ||
    (stroke?.points ?? []).some((point) => point?.anchor && point.anchor.path !== path);
});

// A note is found by page identity, not by the exact URL string.
exportCtx.settings.webNotes = [{
  id: "n1", url: "https://example.com/post/", title: "示例", sourceTitle: "示例",
  noteHtml: "", noteText: "原文", noteMarkdown: "## 原文", doodleSvg: "", pageHtml: "", pageText: "",
  pageEdits: [], markdownPath: "", updatedAt: 0, createdAt: 0
}];
check(
  "a saved note is found again through a hash or trailing-slash URL",
  Boolean(exportCtx.findWebNoteByUrl("https://example.com/post#top")) &&
    Boolean(exportCtx.findWebNoteByUrl("https://example.com/post"))
);
check("an unrelated page still resolves to no note", exportCtx.findWebNoteByUrl("https://example.com/other") === undefined);

// The export must go through the vault API so Obsidian indexes the file.
const target = exportCtx.settings.webNotes[0];
const exported = await exportCtx.exportWebNoteMarkdown(target);
check("存 MD creates the file through the vault API", vaultCalls.create === 1 && vaultFiles.has(exported.markdownPath));
check("the exported file holds the note's Markdown", (vaultFiles.get(exported.markdownPath) ?? "").includes("## 原文"));
check("the note remembers where it was written", exported.markdownPath === "Mobile Webviewer Notes/示例.md");

await exportCtx.exportWebNoteMarkdown(exported);
check("saving the same note again modifies instead of duplicating", vaultCalls.modify === 1 && vaultCalls.create === 1);

// No stored note at all: 存 MD must still write what is on screen.
const embedEl = window.document.createElement("div");
embedEl.className = "mwv-embed";
embedEl.dataset.url = "https://fresh.example/page";
const panel = window.document.createElement("div");
panel.className = "mwv-reader-panel";
panel.dataset.url = "https://fresh.example/page";
const titleEl = window.document.createElement("h2");
titleEl.className = "mwv-page-title";
titleEl.textContent = "Fresh Page";
const editorEl = window.document.createElement("div");
editorEl.className = "mwv-webnote-editor";
editorEl.innerHTML = "<h2>正文</h2><p>内容</p>";
panel.appendChild(titleEl);
panel.appendChild(editorEl);
embedEl.appendChild(panel);
window.document.body.appendChild(embedEl);
await exportCtx.exportEmbedWebNote(embedEl);
const fresh = [...vaultFiles.keys()].find((path) => path.includes("Fresh Page"));
check("存 MD writes a note even when nothing was autosaved yet", Boolean(fresh));
check("the note written from the panel keeps the page text", (vaultFiles.get(fresh) ?? "").includes("正文"));

/* ------------------------------------------------------------------ *
 * 4b. 存 MD carries the page's NoteDraw ink onto the saved note
 * ------------------------------------------------------------------ */
// A page with real ink: strokes anchored to the page's virtual file, plus the
// reader's own SVG doodle layer as the pre-ink fallback.
const inkedPage = {
  id: "n2",
  url: "https://inked.example/article/",
  title: "带画的页面",
  sourceTitle: "带画的页面",
  noteHtml: "",
  noteText: "正文",
  noteMarkdown: "## 正文",
  doodleSvg: '<path d="M0 0L10 10"/>',
  pageHtml: "",
  pageText: "",
  pageEdits: [],
  markdownPath: "",
  updatedAt: 0,
  createdAt: 0
};
const pageFile = exportCtx.noteDrawWebviewFileForUrl(inkedPage.url);
const pageStroke = (id) => ({
  elementId: id,
  layout: {
    v: "1",
    id,
    basis: "note-element-frame-v1",
    primary: "topLeft",
    corners: {
      topLeft: { x: 0.1, y: 0.2, path: pageFile.path },
      bottomRight: { x: 0.3, y: 0.4, path: pageFile.path }
    },
    sourceFrame: { surfaceWidth: 360, documentHeight: 1200 }
  },
  points: [
    { x: 0.1, y: 0.2, anchor: { path: pageFile.path, line: 3 } },
    { x: 0.3, y: 0.4, anchor: { path: pageFile.path, line: 3 } }
  ]
});
noteInk.set(pageFile.path, {
  version: 2,
  sourcePath: pageFile.path,
  strokes: [pageStroke("el-1"), pageStroke("el-2")],
  markdownBlocks: [],
  elementGroups: [],
  webEdits: [],
  updatedAt: "2026-10-25T00:00:00.000Z"
});
const inkedExport = await exportCtx.exportWebNoteMarkdown(inkedPage);
const carriedInk = noteInk.get(inkedExport.markdownPath);
const carriedPaths = (carriedInk?.strokes ?? []).flatMap((stroke) =>
  Object.values(stroke.layout?.corners ?? {}).map((corner) => corner?.path)
);
check("存 MD carries the page's strokes onto the saved note",
  (carriedInk?.strokes ?? []).length === 2 &&
  (carriedInk?.strokes ?? []).every((stroke) => Object.values(stroke.layout?.corners ?? {}).every((corner) => corner.path === inkedExport.markdownPath)));
check("carried strokes point their points at the note, not the page",
  (carriedInk?.strokes ?? []).every((stroke) => stroke.points.every((point) => point.anchor?.path === inkedExport.markdownPath)));
check("the carried drawing belongs to the note file",
  carriedInk?.sourcePath === inkedExport.markdownPath && carriedPaths.every((p) => p === inkedExport.markdownPath));
check("the SVG doodle block is dropped once the ink travels",
  !(vaultFiles.get(inkedExport.markdownPath) ?? "").includes("## Doodle"));

// A note the reader has already drawn on keeps its own, richer ink.
const richer = {
  version: 2,
  sourcePath: inkedExport.markdownPath,
  strokes: [pageStroke("note-1"), pageStroke("note-2"), pageStroke("note-3"), pageStroke("note-4")],
  markdownBlocks: [],
  elementGroups: [],
  webEdits: [],
  updatedAt: "2026-10-25T01:00:00.000Z"
};
noteInk.set(inkedExport.markdownPath, JSON.parse(JSON.stringify(richer)));
await exportCtx.exportWebNoteMarkdown(inkedExport);
check("re-exporting never replaces a note's own richer ink",
  (noteInk.get(inkedExport.markdownPath)?.strokes ?? []).length === 4);

// Without NoteDraw the SVG fallback still has to survive.
exportCtx.getNoteDrawPlugin = () => null;
const plainExport = await exportCtx.exportWebNoteMarkdown({ ...inkedPage, id: "n3", url: "https://plain.example/x", title: "没有 NoteDraw" });
check("without NoteDraw the SVG doodle block is kept",
  (vaultFiles.get(plainExport.markdownPath) ?? "").includes("## Doodle"));
exportCtx.getNoteDrawPlugin = () => noteDrawStub;

/* ------------------------------------------------------------------ *
 * 5. One wand per leaf
 * ------------------------------------------------------------------ */
const wandMethods = ["enforceSingleNoteDrawWand", "noteDrawButtonBelongsToSurface"];
const wandEntries = wandMethods.map((name) => {
  const extracted = extractMethod(source, name);
  return `  ${name}: ${extracted.isAsync ? "async " : ""}function${extracted.paramsAndBody}`;
});
const wandJs = esbuild.transformSync(`const __W = {\n${wandEntries.join(",\n")}\n};\n__W;`, {
  loader: "ts", format: "cjs", target: "es2020"
}).code;
const WAND_SELECTOR = ".notedraw-header-button, .notedraw-webview-button, .notedraw-fallback-button, .notedraw-webview-inline-button";
const wandTable = new Function("NOTEDRAW_BUTTON_SELECTOR", "MWV_DEDUPE_ROOT_SELECTOR", `${wandJs}\nreturn __W;`)(
  WAND_SELECTOR,
  ".mwv-root, .mwv-embed, .mwv-note-embed, .mwv-bing-home"
);
const wandCtx = Object.assign({}, wandTable, {
  isMobileWebviewerSurface: () => true,
  isNoteWebOwnedElement: () => true,
  isNoteDrawSurfaceElement: () => true
});

function makeWandLeaf({ header = true, headerWeb = false, inlineWand = false } = {}) {
  const leaf = window.document.createElement("div");
  leaf.className = "workspace-leaf-content mwv-notedraw-surface-leaf";
  const view = window.document.createElement("div");
  const actions = window.document.createElement("div");
  actions.className = "view-actions";
  view.appendChild(actions);
  leaf.appendChild(view);
  const embed = window.document.createElement("div");
  embed.className = "mwv-embed";
  embed.dataset.url = "https://example.com/";
  leaf.appendChild(embed);
  const surfaceWand = (parent, cls, surfaceType) => {
    const button = window.document.createElement("div");
    button.className = cls;
    button._noteDrawController = { surfaceType };
    parent.appendChild(button);
    return button;
  };
  if (header) surfaceWand(actions, "clickable-icon view-action notedraw-header-button", "preview");
  if (headerWeb) surfaceWand(actions, "clickable-icon view-action notedraw-webview-button", "webview");
  if (inlineWand) {
    const row = window.document.createElement("div");
    row.className = "mwv-note-actions";
    embed.appendChild(row);
    surfaceWand(row, "clickable-icon mwv-icon-button notedraw-webview-button notedraw-webview-inline-button", "webview");
  }
  window.document.body.appendChild(leaf);
  return leaf;
}

const dupLeaves = [];
{
  const leaf = makeWandLeaf({ header: true, headerWeb: true });
  dupLeaves.push(leaf);
  wandCtx.enforceSingleNoteDrawWand(leaf);
  const buttons = [...leaf.querySelectorAll(WAND_SELECTOR)];
  check("two wands in one header leave exactly one visible",
    buttons.length === 2 && buttons.filter((b) => !b.classList.contains("mwv-notedraw-dup-hidden")).length === 1);
  check("the header wand that edits the page is the one kept",
    !buttons[1].classList.contains("mwv-notedraw-dup-hidden") &&
    buttons[0].classList.contains("mwv-notedraw-dup-hidden"));
  check("a duplicate wand is hidden, never removed", buttons.length === 2 && buttons.every((b) => b.isConnected));
}
{
  const leaf = makeWandLeaf({ header: true, inlineWand: true });
  dupLeaves.push(leaf);
  wandCtx.enforceSingleNoteDrawWand(leaf);
  const buttons = [...leaf.querySelectorAll(WAND_SELECTOR)];
  const visible = buttons.filter((b) => !b.classList.contains("mwv-notedraw-dup-hidden"));
  check("a wand dropped inside the note body never doubles the header one",
    buttons.length === 2 && visible.length === 1 && visible[0].closest(".view-actions"));
  check("the kept wand is never marked as a hidden source button",
    !visible[0].classList.contains("mwv-notedraw-source-button"));
}
{
  const leaf = makeWandLeaf({ header: true });
  dupLeaves.push(leaf);
  wandCtx.enforceSingleNoteDrawWand(leaf);
  const buttons = [...leaf.querySelectorAll(WAND_SELECTOR)];
  check("a single wand is left completely alone",
    buttons.length === 1 && !buttons[0].classList.contains("mwv-notedraw-dup-hidden"));
}
for (const leaf of dupLeaves) leaf.remove();


/* ------------------------------------------------------------------ */
const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
if (failed.length) {
  console.error(`NoteWeb safety verification failed: ${failed.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`NoteWeb safety verification passed (${checks.length}/${checks.length}).`);
}
