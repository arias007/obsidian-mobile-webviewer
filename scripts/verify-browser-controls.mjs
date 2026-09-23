/**
 * Behavioural checks for the Mobile Webviewer browser controls.
 *
 * The other verification script asserts against the *text* of main.ts. That is
 * exactly why 142 source-shape checks could pass while the toolbar was
 * unusable: a regex cannot notice that the toolbar is torn down and rebuilt
 * dozens of times a minute, nor that a tap lands on a node that was replaced
 * before the click fired.
 *
 * These tests instead extract the real method bodies from main.ts, compile them
 * with esbuild (to strip the TypeScript annotations) and run them against a real
 * DOM (jsdom), with Obsidian's HTMLElement helpers polyfilled. Every assertion
 * below failed against the pre-fix source.
 *
 * Run: node scripts/verify-browser-controls.mjs
 * (jsdom must be resolvable — see NODE_PATH in the repo's tooling notes.)
 */
import fs from "node:fs";
import { JSDOM } from "jsdom";
import * as esbuild from "esbuild";

const sourcePath = process.env.MWV_SOURCE || "main.ts";
const source = fs.readFileSync(sourcePath, "utf8");
const MAX_BROWSER_TABS = 16;
const MAX_LIVE_TAB_SURFACES = 5;

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
  throw new Error("unterminated method body");
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

/** Extract a column-0 module-level function (e.g. equivalentEmbedUrl). */
function extractTopLevelFunction(src, name) {
  const re = new RegExp(`^function ${name}\\s*\\(`, "m");
  const m = re.exec(src);
  if (!m) throw new Error(`top-level function not found: ${name}`);
  const end = findBodyEnd(src, src.indexOf("{", src.indexOf("(", m.index)));
  return src.slice(m.index, end + 1);
}

const METHODS = [
  "renderEmbedTabstrip",
  "findEmbedTabstripItem",
  "ensureEmbedTabstripAdd",
  "bindEmbedTabstrip",
  "resolveTabstripEmbed",
  "bindEmbedChrome",
  "runBrowserAction",
  "settleEmbedTabs",
  "refreshEmbedTabstrips",
  "syncEmbedChromeNavState",
  "canNavigateEmbed",
  "canDriveBrowserSurface",
  "isElectronWebview",
  "updateEmbedChrome",
  "ensureEmbedChrome",
  "pinEmbedChrome",
  "renderBrowserChrome",
  "renderTabStrip"
];

function buildMethodTable(src) {
  const entries = METHODS.map((name) => {
    let extracted;
    try {
      extracted = extractMethod(src, name);
    } catch (error) {
      // Keep the suite runnable against older sources so it can be used as a
      // negative control: a missing method becomes a stub that fails loudly.
      return `  ${name}: function () { throw new Error(${JSON.stringify(`method missing in this source: ${name}`)}); }`;
    }
    return `  ${name}: ${extracted.isAsync ? "async " : ""}function ${extracted.paramsAndBody}`;
  });
  const ts = `const __M = {\n${entries.join(",\n")}\n};\n__M;\n`;
  const js = esbuild.transformSync(ts, { loader: "ts", format: "cjs", target: "es2020" }).code;
  const factory = new Function(
    "setIcon",
    "hostName",
    "Notice",
    "document",
    "window",
    "Node",
    "HTMLElement",
    "HTMLButtonElement",
    "HTMLInputElement",
    "MAX_BROWSER_TABS",
    `${js}\nreturn __M;`
  );
  return factory;
}

const makeMethodTable = buildMethodTable(source);

/**
 * The three tab mutations are extracted separately: the harness below installs
 * *stubs* under those names (so the chrome buttons can be tested without a real
 * tab store), and Object.assign would overwrite a real body placed in METHODS.
 * Keeping them on a side table lets a test drive the real code with `call(ctx)`.
 */
function buildTabMutationTable(src) {
  const names = ["newEmbedBrowserTab", "switchEmbedBrowserTab", "closeEmbedBrowserTab", "syncEmbedActiveTab", "updateBrowserTab"];
  const entries = names.map((name) => {
    try {
      const { isAsync, paramsAndBody } = extractMethod(src, name);
      return `  ${name}: ${isAsync ? "async " : ""}function ${paramsAndBody}`;
    } catch (error) {
      // Keep the suite runnable against older sources: a missing method
      // becomes a stub that fails loudly when a test actually drives it.
      return `  ${name}: function () { throw new Error(${JSON.stringify(`method missing in this source: ${name}`)}); }`;
    }
  });
  // syncEmbedActiveTab compares URLs through the module-level
  // equivalentEmbedUrl — extracted here. hostName's real body pulls a deep
  // utility-page dependency chain, so the suite's simple hostName (the same
  // one the method table receives) is used instead.
  let eqJs = "function equivalentEmbedUrl() { throw new Error('equivalentEmbedUrl missing in this source'); }";
  try {
    eqJs = esbuild.transformSync(extractTopLevelFunction(src, "equivalentEmbedUrl"), { loader: "ts", format: "cjs", target: "es2020" }).code;
  } catch (error) {
    // keep the throwing stub
  }
  const hostNameJs = "function hostName(url) { try { return new URL(url).hostname.replace(/^www\\./, ''); } catch { return String(url || ''); } }";
  const ts = `const __T = {\n${entries.join(",\n")}\n};\n__T;\n`;
  const js = esbuild.transformSync(ts, { loader: "ts", format: "cjs", target: "es2020" }).code;
  return new Function("MAX_BROWSER_TABS", `${eqJs}\n${hostNameJs}\n${js}\nreturn __T;`)(MAX_BROWSER_TABS);
}

const tabMutations = buildTabMutationTable(source);

/**
 * 0.4.25 tab keep-alive: the pool helpers are extracted separately so the
 * keep-alive checks can drive the real bodies against a jsdom surface without
 * dragging in renderLiveBrowserSurface's full collaborator set.
 */
function buildKeepAliveTable(src) {
  const names = [
    "ownsEmbedSurfaceView",
    "findEmbedSurfaceForTab",
    "activateEmbedSurfaceForTab",
    "evictParkedEmbedSurfaces",
    "destroyEmbedSurfaceForTab",
    "adoptEmbedSurfaceForSuccessor",
    "recordParkedSurfaceNavigation",
    "recordParkedSurfaceTitle"
  ];
  const entries = names.map((name) => {
    try {
      const { isAsync, paramsAndBody } = extractMethod(src, name);
      return `  ${name}: ${isAsync ? "async " : ""}function ${paramsAndBody}`;
    } catch (error) {
      // Older sources (negative control) fail loudly when a keep-alive check
      // actually drives the missing method.
      return `  ${name}: function () { throw new Error(${JSON.stringify(`method missing in this source: ${name}`)}); }`;
    }
  });
  const ts = `const __K = {\n${entries.join(",\n")}\n};\n__K;\n`;
  const js = esbuild.transformSync(ts, { loader: "ts", format: "cjs", target: "es2020" }).code;
  // recordParkedSurfaceNavigation normalizes through the module-level
  // normalizeInput; identity stub — the checks only assert routing, not
  // normalization (covered by the note-browser suite).
  return new Function(
    "MAX_LIVE_TAB_SURFACES",
    `function normalizeInput(url) { return String(url || ""); }\n${js}\nreturn __K;`
  )(MAX_LIVE_TAB_SURFACES);
}

const keepAlive = buildKeepAliveTable(source);

/* ------------------------------------------------------------------ *
 * Minimal harness
 * ------------------------------------------------------------------ */

const results = [];
const check = (label, fn) => {
  try {
    const detail = fn();
    // Async checks are awaited in the report pass so the suite stays ordered and
    // a rejection is reported as a failure rather than an unhandled rejection.
    if (detail && typeof detail.then === "function") results.push({ label, promise: detail });
    else results.push({ label, ok: true, detail });
  } catch (error) {
    results.push({ label, ok: false, detail: String(error && error.message ? error.message : error) });
  }
};
const assert = (cond, message) => {
  if (!cond) throw new Error(message);
};

function installObsidianDom(win) {
  const proto = win.HTMLElement.prototype;
  const applyOptions = (el, options) => {
    if (!options) return el;
    if (options.cls) el.className = options.cls;
    if (options.text !== undefined) el.textContent = options.text;
    if (options.attr) for (const [key, value] of Object.entries(options.attr)) el.setAttribute(key, String(value));
    if (options.href !== undefined) el.setAttribute("href", String(options.href));
    if (options.type !== undefined) el.setAttribute("type", String(options.type));
    if (options.title !== undefined) el.setAttribute("title", String(options.title));
    if (options.placeholder !== undefined) el.setAttribute("placeholder", String(options.placeholder));
    if (options.value !== undefined) el.value = options.value;
    return el;
  };
  Object.defineProperties(proto, {
    createEl: {
      value(tag, options) {
        const el = this.ownerDocument.createElement(tag);
        applyOptions(el, options);
        this.appendChild(el);
        return el;
      }
    },
    createDiv: { value(options) { return this.createEl("div", options); } },
    createSpan: { value(options) { return this.createEl("span", options); } },
    empty: { value() { while (this.firstChild) this.removeChild(this.firstChild); return this; } },
    addClass: { value(...classes) { for (const c of classes) if (c) this.classList.add(c); return this; } },
    removeClass: { value(...classes) { for (const c of classes) if (c) this.classList.remove(c); return this; } },
    toggleClass: {
      value(classes, on) {
        const list = Array.isArray(classes) ? classes : [classes];
        for (const c of list) {
          if (!c) continue;
          if (on === undefined) this.classList.toggle(c);
          else if (on) this.classList.add(c);
          else this.classList.remove(c);
        }
        return this;
      }
    },
    hasClass: { value(c) { return this.classList.contains(c); } },
    setText: {
      value(value) {
        if (typeof value === "string" || typeof value === "number") this.textContent = String(value);
        return this;
      }
    }
  });
}

function createWorld({ withWebview = true, newTabStrip = false } = {}) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
  const win = dom.window;
  installObsidianDom(win);

  const doc = win.document;
  const leafContent = doc.createElement("div");
  leafContent.className = "workspace-leaf-content mwv-note-browser-view";
  const header = doc.createElement("div");
  header.className = "view-header";
  const headerActions = doc.createElement("div");
  headerActions.className = "view-actions";
  header.appendChild(headerActions);
  leafContent.appendChild(header);
  const viewContent = doc.createElement("div");
  viewContent.className = "view-content";
  leafContent.appendChild(viewContent);
  doc.body.appendChild(leafContent);

  const embed = doc.createElement("div");
  embed.className = "mwv-embed mwv-note-embed is-web-front";
  embed.dataset.url = "https://example.org/";
  embed.dataset.mwvBrowserMode = "web";
  embed.dataset.mwvActiveTabId = "t1";
  viewContent.appendChild(embed);

  let surface = null;
  if (withWebview) {
    const liveBrowser = doc.createElement("div");
    liveBrowser.className = "mwv-live-browser";
    surface = doc.createElement("webview");
    surface.className = "mwv-live-frame";
    surface.getURL = () => "https://example.org/";
    surface.canGoBack = () => false;
    surface.canGoForward = () => false;
    liveBrowser.appendChild(surface);
    embed.appendChild(liveBrowser);
  }

  const notices = [];
  const navigations = [];
  const calls = { openUrlInEmbed: [], renderBrowserChrome: 0, switchTab: [], closeTab: [], newTab: [], renderTabStripHost: 0, createTab: 0, saved: 0 };

  const leaf = { id: "leaf-1" };
  const binding = { navButtons: [] };

  const table = makeMethodTable(
    (el, name) => { el.setAttribute("data-icon", name); },
    (url) => {
      try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return String(url || ""); }
    },
    function Notice(message) { notices.push(message); },
    doc,
    win,
    win.Node,
    win.HTMLElement,
    win.HTMLButtonElement,
    win.HTMLInputElement,
    MAX_BROWSER_TABS
  );

  const ctx = Object.assign(table, {
    settings: {
      homeUrl: "https://home.example/",
      browserTabs: [{ id: "t1", title: "One", url: "https://example.org/", back: [], forward: [] }],
      activeBrowserTabId: "t1",
      noteBrowserUrl: "https://example.org/"
    },
    tr: (key) => key,
    syncEmbedChromeNavState: table.syncEmbedChromeNavState,
    renderEmbedTabstrip: table.renderEmbedTabstrip,
    findEmbedTabstripItem: table.findEmbedTabstripItem,
    ensureEmbedTabstripAdd: table.ensureEmbedTabstripAdd,
    bindEmbedTabstrip: table.bindEmbedTabstrip,
    bindEmbedChrome: table.bindEmbedChrome,
    runBrowserAction: table.runBrowserAction,
    settleEmbedTabs: table.settleEmbedTabs,
    refreshEmbedTabstrips: table.refreshEmbedTabstrips,
    updateEmbedChrome: table.updateEmbedChrome,
    pinEmbedChrome: table.pinEmbedChrome,
    noteBrowserNativeBindings: new Map([[leaf, binding]]),
    findWorkspaceLeafForElement: () => leaf,
    app: { workspace: { getLeavesOfType: () => [leaf] } },
    getNoteBrowserEmbed: () => embed,
    // Collaborators the tab mutations await. openUrlInEmbed is deliberately a
    // no-op that never repaints: that is the live failure mode (the navigation
    // bails on a superseded render token), so the row must survive without it.
    flushEmbedReaderNow: async () => {},
    syncEmbedActiveTab: async () => {},
    saveSettings: async () => { calls.saved += 1; },
    emitApiEvent: () => {},
    persistEmbedState: async () => {},
    resetNoteDrawWebviewControllers: async () => {},
    setEmbedStack: (el, key, stack) => { el.dataset["__stack" + key] = JSON.stringify(stack); },
    createBrowserTab: (url) => {
      calls.createTab += 1;
      return { id: `t-new-${calls.createTab}`, title: String(url || ""), url: url || ctx.settings.homeUrl, back: [], forward: [], time: 0 };
    },
    getEmbedSurfaceTitle: () => "Example",
    getEmbedStack: (el, key) => {
      const raw = el.dataset["__stack" + key] ?? "[]";
      return JSON.parse(raw);
    },
    setNoteBrowserEmbedMode: () => {},
    navigateEmbedBack: () => { navigations.push("back"); },
    navigateEmbedForward: () => { navigations.push("forward"); },
    openUrlInEmbed: (el, url) => { calls.openUrlInEmbed.push(url); },
    exportEmbedWebNote: () => {},
    ensureNoteBrowserMoreButton: () => null,
    renderBookmarksBar: () => {},
    watchEmbedChrome: () => {},
    syncNoteBrowserNativeIdentity: () => {},
    addConsole: () => {},
    switchEmbedBrowserTab: (el, id) => { calls.switchTab.push(id); },
    closeEmbedBrowserTab: (el, id) => { calls.closeTab.push(id); },
    newEmbedBrowserTab: (el) => { calls.newTab.push(true); },
    getEmbedActiveTab: () => ctx.settings.browserTabs.find((t) => t.id === ctx.settings.activeBrowserTabId) ?? ctx.settings.browserTabs[0],
    updateBrowserTab: async () => {},
    // Keep-alive collaborators. The tab-mutation checks stub them out (they
    // assert row behaviour, not surface pooling); the keep-alive checks below
    // drive the real extracted bodies instead.
    activateEmbedSurfaceForTab: () => {},
    adoptEmbedSurfaceForSuccessor: () => {},
    destroyEmbedSurfaceForTab: () => {},
    activeBrowserTabId: "t1",
    ensureBrowserTab: () => ({ id: "t1", title: "One", url: "https://example.org/" }),
    plugin: null
  });

  // Count the real chrome rebuilds instead of letting ensureEmbedChrome use them.
  const realRenderBrowserChrome = table.renderBrowserChrome;
  ctx.renderBrowserChrome = (el, url, title) => {
    calls.renderBrowserChrome += 1;
    return realRenderBrowserChrome.call(ctx, el, url, title);
  };

  // Standalone-view methods read through this.plugin.
  ctx.plugin = { settings: ctx.settings, tr: ctx.tr, ensureBrowserTab: ctx.ensureBrowserTab };

  for (const entry of ctx.settings.browserTabs) {
    if (!ctx.getEmbedStack(embed, "mwvBack")) { /* noop */ }
  }
  embed.dataset["__stackmwvBack"] = "[]";
  embed.dataset["__stackmwvForward"] = "[]";

  ctx.renderBrowserChrome(embed, embed.dataset.url, "Example");

  return { win, doc, embed, leaf, binding, notices, navigations, calls, ctx, leafContent, header, surface, newTabStrip };
}

const click = (win, el) => {
  const opts = { bubbles: true, cancelable: true, view: win, button: 0 };
  el.dispatchEvent(new win.PointerEvent("pointerdown", opts));
  el.dispatchEvent(new win.MouseEvent("mousedown", opts));
  el.dispatchEvent(new win.PointerEvent("pointerup", opts));
  el.dispatchEvent(new win.MouseEvent("mouseup", opts));
  el.dispatchEvent(new win.MouseEvent("click", opts));
};

const chromeOf = (embed) => embed.querySelector(":scope > .mwv-browser-chrome");
const navButton = (embed, nav) => Array.from(embed.querySelectorAll(".mwv-browser-nav")).find((b) => b.dataset.mwvBrowserNav === nav);
const stripOf = (doc) => doc.querySelector(".mwv-embed-tabstrip");

/* ------------------------------------------------------------------ *
 * Checks
 * ------------------------------------------------------------------ */

check("chrome exposes back / forward / home in the address row", () => {
  const { embed } = createWorld();
  const chrome = chromeOf(embed);
  assert(chrome, "no chrome was built");
  const address = chrome.querySelector(".mwv-browser-address");
  assert(address, "no address row");
  for (const nav of ["back", "forward", "home"]) {
    const button = navButton(embed, nav);
    assert(button, `missing ${nav} button`);
    assert(address.contains(button), `${nav} button is not in the address row`);
    assert(button.getAttribute("type") === "button", `${nav} must not submit the address form`);
  }
  return "back/forward/home present in the address row";
});

check("heartbeat update does not rebuild a healthy chrome", () => {
  const { embed, calls, ctx } = createWorld();
  const chrome = chromeOf(embed);
  const back = navButton(embed, "back");
  ctx.ensureEmbedChrome(embed);
  ctx.ensureEmbedChrome(embed);
  ctx.ensureEmbedChrome(embed);
  assert(calls.renderBrowserChrome === 1, `chrome was rebuilt ${calls.renderBrowserChrome} times, expected 1`);
  assert(chromeOf(embed) === chrome, "the chrome element was replaced");
  assert(navButton(embed, "back") === back, "the back button was replaced");
  return "3 heartbeat ticks, 1 chrome build, identical nodes";
});

check("tab strip survives repeated chrome updates with stable identity", () => {
  const { embed, ctx, doc } = createWorld();
  const strip = stripOf(doc);
  assert(strip, "no tab strip was rendered");
  const item = strip.querySelector(".mwv-embed-tab");
  for (const url of ["https://a.example/", "https://b.example/", "https://c.example/"]) {
    ctx.updateEmbedChrome(embed, url, "Example");
  }
  assert(stripOf(doc) === strip, "the tab strip was replaced by a chrome update");
  assert(strip.querySelector(".mwv-embed-tab") === item, "a tab element was replaced by a chrome update");
  return "strip and tab nodes identical across 3 navigations";
});

check("exactly one tab strip, and it stays in one host", () => {
  const { embed, ctx, doc } = createWorld();
  for (let i = 0; i < 5; i += 1) ctx.updateEmbedChrome(embed, "https://example.org/", "Example");
  const strips = doc.querySelectorAll(".mwv-embed-tabstrip");
  assert(strips.length === 1, `expected 1 strip, found ${strips.length}`);
  assert(strips[0].parentElement.classList.contains("view-header"), "the strip is not in the header row");
  for (let i = 0; i < 3; i += 1) ctx.renderEmbedTabstrip(embed);
  assert(doc.querySelectorAll(".mwv-embed-tabstrip").length === 1, "a duplicate strip appeared");
  return "one strip, still in the header after 8 re-renders";
});

check("active tab marker follows the active tab id", () => {
  const { embed, ctx, doc } = createWorld();
  ctx.settings.browserTabs = [
    { id: "t1", title: "One", url: "https://one.example/", back: [], forward: [] },
    { id: "t2", title: "Two", url: "https://two.example/", back: [], forward: [] }
  ];
  ctx.renderEmbedTabstrip(embed);
  let active = doc.querySelector(".mwv-embed-tab.is-active");
  assert(active && active.dataset.mwvTabId === "t1", "t1 should be active");
  // The embed's own active-tab marker is authoritative for its strip.
  ctx.settings.activeBrowserTabId = "t2";
  embed.dataset.mwvActiveTabId = "t2";
  ctx.renderEmbedTabstrip(embed);
  active = doc.querySelector(".mwv-embed-tab.is-active");
  assert(active && active.dataset.mwvTabId === "t2", "t2 should be active");
  assert(doc.querySelectorAll(".mwv-embed-tab").length === 2, "tab count changed");
  return "active marker moved from t1 to t2 in place";
});

check("closing a background tab removes exactly that tab", () => {
  const { embed, ctx, doc } = createWorld();
  ctx.settings.browserTabs = [
    { id: "t1", title: "One", url: "https://one.example/", back: [], forward: [] },
    { id: "t2", title: "Two", url: "https://two.example/", back: [], forward: [] },
    { id: "t3", title: "Three", url: "https://three.example/", back: [], forward: [] }
  ];
  ctx.renderEmbedTabstrip(embed);
  const keep = Array.from(doc.querySelectorAll(".mwv-embed-tab")).find((n) => n.dataset.mwvTabId === "t3");
  ctx.settings.browserTabs = ctx.settings.browserTabs.filter((t) => t.id !== "t1");
  ctx.renderEmbedTabstrip(embed);
  const ids = Array.from(doc.querySelectorAll(".mwv-embed-tab")).map((n) => n.dataset.mwvTabId);
  assert(ids.length === 2, `expected 2 tabs, found ${ids.length}`);
  assert(!ids.includes("t1"), "the closed tab is still rendered");
  assert(doc.querySelectorAll(".mwv-embed-tab").length === 2, "duplicate rows");
  assert(keep.parentElement, "an unrelated tab was destroyed");
  return "t1 removed, t2/t3 untouched";
});

check("a tab tap switches, a tap on its close icon closes", () => {
  const { win, embed, ctx, doc, calls } = createWorld();
  ctx.settings.browserTabs = [
    { id: "t1", title: "One", url: "https://one.example/", back: [], forward: [] },
    { id: "t2", title: "Two", url: "https://two.example/", back: [], forward: [] }
  ];
  ctx.renderEmbedTabstrip(embed);
  const second = Array.from(doc.querySelectorAll(".mwv-embed-tab")).find((n) => n.dataset.mwvTabId === "t2");
  click(win, second.querySelector(".mwv-embed-tab-title"));
  assert(calls.switchTab.length === 1 && calls.switchTab[0] === "t2", `switch not routed: ${JSON.stringify(calls.switchTab)}`);
  click(win, second.querySelector(".mwv-embed-tab-close"));
  assert(calls.closeTab.length === 1 && calls.closeTab[0] === "t2", `close not routed: ${JSON.stringify(calls.closeTab)}`);
  click(win, doc.querySelector(".mwv-embed-tab-new"));
  assert(calls.newTab.length === 1, "the new-tab button did not fire");
  return "switch / close / new-tab all routed";
});

check("back is enabled from the guest history even with an empty host stack", () => {
  const { embed, ctx } = createWorld();
  ctx.surface?.canGoBack; // surface is created in the world
  const surface = embed.querySelector(".mwv-live-frame");
  surface.canGoBack = () => true;
  surface.canGoForward = () => false;
  embed.dataset["__stackmwvBack"] = "[]";
  embed.dataset["__stackmwvForward"] = "[]";
  ctx.syncEmbedChromeNavState(embed);
  const back = navButton(embed, "back");
  const forward = navButton(embed, "forward");
  assert(back.disabled === false, "back should be enabled: the guest can go back");
  assert(forward.disabled === true, "forward should stay disabled");
  return "guest history drives the enabled state";
});

check("syncEmbedChromeNavState also drives Obsidian's header arrows", () => {
  const { embed, ctx, binding, win, header, headerActions } = createWorld();
  const nativeBack = win.document.createElement("button");
  const nativeForward = win.document.createElement("button");
  // The real binding only tracks buttons that are actually mounted.
  const navContainer = win.document.createElement("div");
  navContainer.className = "view-header-nav-buttons";
  navContainer.appendChild(nativeBack);
  navContainer.appendChild(nativeForward);
  header.insertBefore(navContainer, headerActions);
  binding.navButtons.push({ element: nativeBack, direction: "back", handler: () => {}, originalDisabled: false });
  binding.navButtons.push({ element: nativeForward, direction: "forward", handler: () => {}, originalDisabled: false });
  const surface = embed.querySelector(".mwv-live-frame");
  surface.canGoBack = () => true;
  surface.canGoForward = () => true;
  ctx.syncEmbedChromeNavState(embed);
  assert(nativeBack.disabled === false, "native back stayed disabled");
  assert(nativeForward.disabled === false, "native forward stayed disabled");
  surface.canGoBack = () => false;
  surface.canGoForward = () => false;
  ctx.syncEmbedChromeNavState(embed);
  assert(nativeBack.disabled === true, "native back should be disabled now");
  return "native header arrows tracked in both directions";
});

check("a stale disabled nav button re-derives instead of doing nothing", () => {
  const { win, embed, ctx, navigations } = createWorld();
  const surface = embed.querySelector(".mwv-live-frame");
  surface.canGoBack = () => false;
  const back = navButton(embed, "back");
  assert(back.disabled === true, "precondition: back starts disabled");
  // The guest navigates in place: it can go back now, but the host never heard.
  surface.canGoBack = () => true;
  click(win, back);
  assert(navigations.includes("back"), "the click was swallowed");
  return "click re-derived the state and navigated";
});

check("an impossible back reports instead of failing silently", () => {
  const { win, embed, ctx, navigations, notices } = createWorld();
  const back = navButton(embed, "back");
  assert(back.disabled === true, "precondition: back starts disabled");
  click(win, back);
  assert(navigations.length === 0, "nothing should navigate");
  assert(notices.length === 1, `expected one notice, got ${notices.length}`);
  return `notice shown: ${notices[0]}`;
});

check("home always navigates to the configured start page", () => {
  const { win, embed, ctx, calls } = createWorld();
  click(win, navButton(embed, "home"));
  assert(calls.openUrlInEmbed.length === 1, "home did nothing");
  assert(calls.openUrlInEmbed[0] === "https://home.example/", `home went to ${calls.openUrlInEmbed[0]}`);
  return "home -> settings.homeUrl";
});

check("the standalone view tab strip keeps tab identity across re-renders", () => {
  const { ctx, win } = createWorld();
  const tabStripEl = win.document.createElement("div");
  tabStripEl.className = "mwv-tab-strip";
  win.document.body.appendChild(tabStripEl);
  ctx.tabStripEl = tabStripEl;
  ctx.settings.browserTabs = [
    { id: "t1", title: "One", url: "https://one.example/" },
    { id: "t2", title: "Two", url: "https://two.example/" }
  ];
  ctx.renderTabStrip();
  const first = tabStripEl.querySelector('[data-mwv-tab-id="t1"]');
  for (let i = 0; i < 4; i += 1) ctx.renderTabStrip();
  assert(tabStripEl.querySelector('[data-mwv-tab-id="t1"]') === first, "the tab button was replaced");
  assert(tabStripEl.querySelectorAll(".mwv-browser-tab").length === 2, "tab count drifted");
  ctx.activeBrowserTabId = "t2";
  ctx.renderTabStrip();
  const active = tabStripEl.querySelector(".mwv-browser-tab.is-active");
  assert(active && active.dataset.mwvTabId === "t2", "active class did not move");
  return "standalone strip reconciled in place";
});

/* --- tab mutations must repaint the row themselves ------------------ *
 * Regression: creating / switching / closing a tab updated
 * settings.browserTabs and left the repaint to the navigation that follows.
 * When that navigation bailed (superseded render token) or the note layer
 * restored a saved `dataset.mwvActiveTabId` over the live embed, the record
 * changed while the row did not — the tab existed but the previous tab stayed
 * highlighted, so tapping a tab looked like a no-op.
 * -------------------------------------------------------------------- */

const tabIdsRoot = (doc) => Array.from(doc.querySelectorAll(".mwv-embed-tab")).map((n) => n.dataset.mwvTabId);
const activeTabId = (doc) => doc.querySelector(".mwv-embed-tab.is-active")?.dataset.mwvTabId ?? null;

check("a new tab shows in the row even when the navigation never repaints", async () => {
  const { embed, ctx, doc, calls } = createWorld();
  const before = tabIdsRoot(doc).length;
  await tabMutations.newEmbedBrowserTab.call(ctx, embed);
  assert(calls.openUrlInEmbed.length >= 1, "the new tab never navigated");
  const ids = tabIdsRoot(doc);
  assert(ids.length === before + 1, `expected ${before + 1} rows, found ${ids.length}`);
  assert(activeTabId(doc) === ctx.settings.activeBrowserTabId, `row active=${activeTabId(doc)} record active=${ctx.settings.activeBrowserTabId}`);
  return `row ${ids.join(",")} — new tab active without a repaint from the navigation`;
});

check("switching a tab marks it active without help from the navigation", async () => {
  const { embed, ctx, doc } = createWorld();
  ctx.settings.browserTabs = [
    { id: "t1", title: "One", url: "https://one.example/", back: [], forward: [] },
    { id: "t2", title: "Two", url: "https://two.example/", back: [], forward: [] }
  ];
  embed.dataset.mwvActiveTabId = "t1";
  ctx.settings.activeBrowserTabId = "t1";
  ctx.renderEmbedTabstrip(embed);
  assert(activeTabId(doc) === "t1", "precondition: t1 active");
  await tabMutations.switchEmbedBrowserTab.call(ctx, embed, "t2");
  assert(activeTabId(doc) === "t2", `the tapped tab is not highlighted (active=${activeTabId(doc)})`);
  return "t2 highlighted after the switch";
});

check("closing the last tab swaps the row to the replacement", async () => {
  const { embed, ctx, doc } = createWorld();
  ctx.settings.browserTabs = [{ id: "t1", title: "One", url: "https://one.example/", back: [], forward: [] }];
  ctx.settings.activeBrowserTabId = "t1";
  embed.dataset.mwvActiveTabId = "t1";
  ctx.renderEmbedTabstrip(embed);
  await tabMutations.closeEmbedBrowserTab.call(ctx, embed, "t1");
  const ids = Array.from(doc.querySelectorAll(".mwv-embed-tab")).map((n) => n.dataset.mwvTabId);
  assert(ids.length === 1, `expected 1 row, found ${ids.length}`);
  assert(!ids.includes("t1"), "the closed tab is still in the row");
  assert(ids[0] === ctx.settings.activeBrowserTabId, `row ${ids[0]} != record ${ctx.settings.activeBrowserTabId}`);
  return `row replaced with ${ids[0]}`;
});

check("closing a background tab repaints without any navigation at all", async () => {
  const { embed, ctx, doc, calls } = createWorld();
  ctx.settings.browserTabs = [
    { id: "t1", title: "One", url: "https://one.example/", back: [], forward: [] },
    { id: "t2", title: "Two", url: "https://two.example/", back: [], forward: [] }
  ];
  ctx.settings.activeBrowserTabId = "t1";
  embed.dataset.mwvActiveTabId = "t1";
  ctx.renderEmbedTabstrip(embed);
  const navsBefore = calls.openUrlInEmbed.length;
  await tabMutations.closeEmbedBrowserTab.call(ctx, embed, "t2");
  assert(calls.openUrlInEmbed.length === navsBefore, "closing a background tab should not navigate");
  const ids = Array.from(doc.querySelectorAll(".mwv-embed-tab")).map((n) => n.dataset.mwvTabId);
  assert(ids.length === 1 && ids[0] === "t1", `row drifted: ${ids.join(",")}`);
  return "background close pruned the row with no navigation";
});

check("a new tab appends to the right of the row", async () => {
  const { embed, ctx, doc } = createWorld();
  ctx.settings.browserTabs = [
    { id: "t1", title: "One", url: "https://one.example/", back: [], forward: [] },
    { id: "t2", title: "Two", url: "https://two.example/", back: [], forward: [] }
  ];
  ctx.settings.activeBrowserTabId = "t1";
  embed.dataset.mwvActiveTabId = "t1";
  ctx.renderEmbedTabstrip(embed);
  await tabMutations.newEmbedBrowserTab.call(ctx, embed);
  const ids = tabIdsRoot(doc);
  const recordIds = ctx.settings.browserTabs.map((t) => t.id);
  assert(ids.join(",") === recordIds.join(","), `row ${ids.join(",")} drifted from record ${recordIds.join(",")}`);
  const newId = recordIds[recordIds.length - 1];
  assert(ids[0] === "t1" && ids[1] === "t2", `existing tabs changed position: ${ids.join(",")}`);
  assert(ids[ids.length - 1] === newId && ctx.settings.activeBrowserTabId === newId, `the new tab is not rightmost/active: ${ids.join(",")}`);
  return `row order ${ids.join(",")} — the new tab sits on the right`;
});

check("a tab keeps its title when it goes background", async () => {
  const { embed, ctx } = createWorld();
  ctx.settings.browserTabs = [
    { id: "t1", title: "Bing: 查询词", url: "https://cn.bing.com/search?q=x", back: [], forward: [] },
    { id: "t2", title: "Two", url: "https://two.example/", back: [], forward: [] }
  ];
  ctx.settings.activeBrowserTabId = "t1";
  embed.dataset.mwvActiveTabId = "t1";
  embed.dataset.url = "https://cn.bing.com/search?q=x";
  // The surface reports no fresh title at the moment the tab is being left
  // (the exact switch-away shape that used to hit the hostname fallback).
  ctx.getEmbedSurfaceTitle = () => "";
  // Drive the REAL sync (the fixture stub would bypass the code under test)
  // with an updateBrowserTab that actually mutates the record.
  ctx.syncEmbedActiveTab = tabMutations.syncEmbedActiveTab;
  ctx.updateBrowserTab = tabMutations.updateBrowserTab;
  ctx.saveSettings = async () => {};
  await tabMutations.switchEmbedBrowserTab.call(ctx, embed, "t2");
  const t1 = ctx.settings.browserTabs.find((t) => t.id === "t1");
  assert(t1.title === "Bing: 查询词", `the background tab's title was downgraded to "${t1.title}"`);
  return "the outgoing sync kept the recorded title instead of the hostname";
});

check("a hostname placeholder never overwrites a tab's real name", async () => {
  const { ctx } = createWorld();
  ctx.settings.browserTabs = [
    { id: "t1", title: "bing.com", url: "https://www.bing.com/", back: [], forward: [] }
  ];
  ctx.updateBrowserTab = tabMutations.updateBrowserTab;
  ctx.saveSettings = async () => {};
  // A hostname placeholder may replace another hostname placeholder.
  await tabMutations.updateBrowserTab.call(ctx, "t1", {
    title: "bing.com", url: "https://www.bing.com/search?q=你好", back: [], forward: [], time: 1
  });
  assert(ctx.settings.browserTabs[0].title === "bing.com", `placeholder did not replace placeholder: ${ctx.settings.browserTabs[0].title}`);
  // A real reported name wins.
  await tabMutations.updateBrowserTab.call(ctx, "t1", {
    title: "Bing: 你好", url: "https://www.bing.com/search?q=你好", back: [], forward: [], time: 2
  });
  assert(ctx.settings.browserTabs[0].title === "Bing: 你好", `a real reported name did not win: ${ctx.settings.browserTabs[0].title}`);
  // The navigate-complete handler fires while the webview is mid-restore and
  // passes the hostname as an EXPLICIT title: it must NOT clobber the real
  // name (this downgrade used to stick when no later title event fired).
  await tabMutations.updateBrowserTab.call(ctx, "t1", {
    title: "bing.com", url: "https://www.bing.com/search?q=你好", back: [], forward: [], time: 3
  });
  assert(ctx.settings.browserTabs[0].title === "Bing: 你好", `real name replaced by the placeholder: ${ctx.settings.browserTabs[0].title}`);
  return "placeholder-to-placeholder allowed, real name applied, placeholder blocked against real name";
});

check("settleEmbedTabs re-asserts the active id the note layer clobbered", () => {
  const { embed, ctx, doc } = createWorld();
  ctx.settings.browserTabs = [
    { id: "t1", title: "One", url: "https://one.example/", back: [], forward: [] },
    { id: "t2", title: "Two", url: "https://two.example/", back: [], forward: [] }
  ];
  embed.dataset.mwvActiveTabId = "t1";
  ctx.settings.activeBrowserTabId = "t2";
  ctx.renderEmbedTabstrip(embed);
  assert(activeTabId(doc) === "t1", "precondition: the stale id wins");
  ctx.settleEmbedTabs(embed);
  assert(embed.dataset.mwvActiveTabId === "t2", "the active id was not re-asserted from the record");
  assert(activeTabId(doc) === "t2", `row active=${activeTabId(doc)}`);
  return "stale dataset id corrected from the record";
});

check("settleEmbedTabs falls back to the first tab when the record lost the id", () => {
  const { embed, ctx, doc } = createWorld();
  ctx.settings.browserTabs = [
    { id: "t1", title: "One", url: "https://one.example/", back: [], forward: [] },
    { id: "t2", title: "Two", url: "https://two.example/", back: [], forward: [] }
  ];
  ctx.settings.activeBrowserTabId = "t-gone";
  embed.dataset.mwvActiveTabId = "t-gone";
  ctx.settleEmbedTabs(embed);
  assert(embed.dataset.mwvActiveTabId === "t1", `expected t1, got ${embed.dataset.mwvActiveTabId}`);
  assert(activeTabId(doc) === "t1", "the row did not fall back to the first tab");
  return "dangling id resolved to the first tab";
});

check("settleEmbedTabs ignores a detached embed", () => {
  const { embed, ctx } = createWorld();
  embed.remove();
  ctx.settleEmbedTabs(embed); // must not throw
  return "detached embed skipped";
});

check("refreshEmbedTabstrips repaints every live note toolbar", () => {
  const { embed, ctx, doc } = createWorld();
  ctx.settings.browserTabs = [
    { id: "t1", title: "One", url: "https://one.example/", back: [], forward: [] },
    { id: "t2", title: "Two", url: "https://two.example/", back: [], forward: [] }
  ];
  embed.dataset.mwvActiveTabId = "t1";
  ctx.settings.activeBrowserTabId = "t2";
  ctx.renderEmbedTabstrip(embed);
  ctx.refreshEmbedTabstrips();
  assert(doc.querySelectorAll(".mwv-embed-tab").length === 2, "the row was not repainted");
  assert(activeTabId(doc) === "t2", `row active=${activeTabId(doc)}`);
  return "all live embeds repainted from the record";
});

check("a reloaded plugin reclaims the tab row from a stale listener", () => {
  const { win, embed, ctx, doc, calls } = createWorld();
  const strip = stripOf(doc);
  assert(strip._mwvTabOwner === ctx, "the first instance did not claim the strip");
  // A plugin reload hands the same DOM node to a brand-new instance.
  const reloaded = Object.create(ctx);
  reloaded.newEmbedBrowserTab = () => { calls.reclaimed = (calls.reclaimed ?? 0) + 1; };
  reloaded.bindEmbedTabstrip(strip, embed);
  assert(strip._mwvTabOwner === reloaded, "the reloaded instance did not take the strip over");
  click(win, doc.querySelector(".mwv-embed-tab-new"));
  assert(calls.newTab.length === 0, "the unloaded instance still handled the tap");
  assert(calls.reclaimed === 1, `the live instance missed the tap (${calls.reclaimed})`);
  return "stale listener bowed out, live instance handled the new-tab tap";
});

check("tab taps route through the delegated strip listener", () => {
  const { win, embed, ctx, doc, calls } = createWorld();
  ctx.settings.browserTabs = [
    { id: "t1", title: "One", url: "https://one.example/", back: [], forward: [] },
    { id: "t2", title: "Two", url: "https://two.example/", back: [], forward: [] }
  ];
  ctx.renderEmbedTabstrip(embed);
  const second = Array.from(doc.querySelectorAll(".mwv-embed-tab")).find((n) => n.dataset.mwvTabId === "t2");
  click(win, second.querySelector(".mwv-embed-tab-close"));
  assert(calls.closeTab.length === 1 && calls.closeTab[0] === "t2", `close not delegated: ${JSON.stringify(calls.closeTab)}`);
  click(win, second.querySelector(".mwv-embed-tab-title"));
  assert(calls.switchTab.length === 1 && calls.switchTab[0] === "t2", `switch not delegated: ${JSON.stringify(calls.switchTab)}`);
  return "close and switch both handled by the strip listener";
});

check("tab taps resolve the live embed at tap time, not the first-bound copy", () => {
  const { win, embed, ctx, doc, calls, leafContent } = createWorld();
  ctx.settings.browserTabs = [
    { id: "t1", title: "One", url: "https://one.example/", back: [], forward: [] },
    { id: "t2", title: "Two", url: "https://two.example/", back: [], forward: [] }
  ];
  // The real-world shape: the header strip was first bound while an older
  // embed element existed; a note re-render created a NEW live embed, and the
  // leaf now holds both copies (the old one stays connected but hidden).
  const stale = doc.createElement("div");
  stale.className = "mwv-embed";
  stale.dataset.url = "https://stale.example/";
  const cmWrap = doc.createElement("div");
  cmWrap.className = "cm-html-embed";
  cmWrap.appendChild(stale);
  leafContent.appendChild(cmWrap);
  const live = doc.createElement("div");
  live.className = "mwv-embed mwv-note-embed";
  live.dataset.url = "https://live.example/";
  leafContent.appendChild(live);
  // The leaf's authoritative accessor reports the live copy.
  ctx.getNoteBrowserEmbed = () => live;

  const seen = { switch: [], close: [] };
  ctx.switchEmbedBrowserTab = (el, id) => { seen.switch.push(el === live ? "live" : el === stale ? "stale" : "other"); };
  ctx.closeEmbedBrowserTab = (el, id) => { seen.close.push(el === live ? "live" : el === stale ? "stale" : "other"); };

  // Repaint from the first-bound embed (the strip is reused; bindEmbedTabstrip
  // early-returns, so the listener's closure still holds the first embed).
  ctx.renderEmbedTabstrip(embed);
  const strip = stripOf(doc);
  assert(strip._mwvTabOwner === ctx, "the strip was not reused across re-renders");
  const second = Array.from(strip.querySelectorAll(".mwv-embed-tab")).find((n) => n.dataset.mwvTabId === "t2");
  click(win, second.querySelector(".mwv-embed-tab-title"));
  click(win, second.querySelector(".mwv-embed-tab-close"));
  assert(seen.switch.length === 1 && seen.switch[0] === "live", `switch acted on ${JSON.stringify(seen.switch)}`);
  assert(seen.close.length === 1 && seen.close[0] === "live", `close acted on ${JSON.stringify(seen.close)}`);
  return "both branches acted on the live embed, not the first-bound copy";
});

check("resolveTabstripEmbed falls back to a connected preferred embed", () => {
  const { embed, ctx, doc } = createWorld();
  const strip = stripOf(doc);
  // No note-browser document copy: the chrome-hosted strip's own embed wins.
  ctx.getNoteBrowserEmbed = () => null;
  assert(ctx.resolveTabstripEmbed(strip, embed) === embed, "the connected preferred embed was not used");
  return "chrome-hosted strips keep acting on their own embed";
});

check("a reloaded plugin reclaims the toolbar from stale nav listeners", () => {
  const { win, embed, ctx, calls, navigations, notices } = createWorld();
  const chrome = chromeOf(embed);
  assert(chrome._mwvChromeOwner === ctx, "the first instance did not claim the chrome");
  const surface = embed.querySelector(".mwv-live-frame");
  surface.canGoBack = () => true;
  ctx.syncEmbedChromeNavState(embed);
  assert(navButton(embed, "back").disabled === false, "precondition: back is enabled");

  // A plugin reload hands the same DOM node to a brand-new instance. The chrome
  // is still "healthy", so the reloaded instance only ever runs the update path.
  const reloaded = Object.create(ctx);
  reloaded.navigateEmbedBack = () => { calls.reclaimedBack = (calls.reclaimedBack ?? 0) + 1; };
  reloaded.updateEmbedChrome(embed, "https://example.org/", "Example");
  assert(chrome._mwvChromeOwner === reloaded, "the reloaded instance did not take the toolbar over");

  click(win, navButton(embed, "back"));
  assert(navigations.length === 0, "the unloaded instance still navigated");
  assert(notices.length === 0, "the unloaded instance raised a notice");
  assert(calls.reclaimedBack === 1, `the live instance missed the tap (${calls.reclaimedBack})`);
  return "stale chrome listeners bowed out, live instance handled the tap";
});

check("repeated chrome updates do not stack listeners or duplicate wiring", () => {
  const { win, embed, ctx, calls, navigations } = createWorld();
  const surface = embed.querySelector(".mwv-live-frame");
  surface.canGoBack = () => true;
  for (let i = 0; i < 5; i += 1) ctx.updateEmbedChrome(embed, "https://example.org/", "Example");
  click(win, navButton(embed, "back"));
  assert(calls.openUrlInEmbed.length === 0, "an update navigated the embed");
  assert(navigations.filter((n) => n === "back").length === 1, `back fired ${navigations.length} times`);
  return "one handler, one navigation across 5 updates";
});

/* ------------------------------------------------------------------ *
 * 0.4.25 tab keep-alive: parked surface pool
 * ------------------------------------------------------------------ */

function createSurfaceWorld() {
  const world = createWorld();
  const { embed, ctx, win, doc } = world;
  const liveBrowser = embed.querySelector(":scope > .mwv-live-browser");
  const calls = { prefs: [], notify: 0, disposed: [], tabPatches: [] };
  ctx.applyFrameViewPreferences = (frame) => { calls.prefs.push(frame); };
  ctx.notifyNoteDrawWebviewChanged = () => { calls.notify += 1; };
  ctx.disposeBrowserSurfacesIn = (node) => { calls.disposed.push(node); };
  ctx.updateBrowserTab = async (tabId, patch) => { calls.tabPatches.push([tabId, patch]); };
  // The world mounts one live surface; tag it as t1's and add a parked t2.
  const live = liveBrowser.querySelector(":scope > .mwv-live-frame");
  live.dataset.mwvSurfaceTabId = "t1";
  live.dataset.mwvSurfaceActiveAt = "100";
  const parked = doc.createElement("webview");
  parked.className = "mwv-parked-frame";
  parked.dataset.mwvSurfaceTabId = "t2";
  parked.dataset.mwvSurfaceActiveAt = "200";
  liveBrowser.appendChild(parked);
  // The real pool helpers resolve each other through `this` — mount the real
  // extracted bodies so the checks drive the actual routing, while the
  // collaborators above stay as recording stubs.
  Object.assign(ctx, keepAlive);
  return Object.assign(world, { liveBrowser, live, parked, calls });
}

check("tab keep-alive: switching to a preserved tab promotes its parked surface and parks the outgoing one", () => {
  const { embed, live, parked, calls, ctx } = createSurfaceWorld();
  keepAlive.activateEmbedSurfaceForTab.call(ctx, embed, "t2");
  assert(parked.hasClass("mwv-live-frame") && !parked.hasClass("mwv-parked-frame"), "the preserved surface did not go live");
  assert(live.hasClass("mwv-parked-frame") && !live.hasClass("mwv-live-frame"), "the outgoing surface stayed live");
  assert(Number(parked.dataset.mwvSurfaceActiveAt) > 200, "the promoted surface did not refresh its recency stamp");
  assert(calls.prefs.includes(parked), "the promoted surface missed its view preferences");
  assert(calls.notify >= 1, "NoteDraw was not told the surface changed");
  return "parked t2 promoted, live t1 parked, prefs reapplied without a reload";
});

check("tab keep-alive: switching to a tab with no preserved surface parks everything", () => {
  const { embed, live, parked, ctx } = createSurfaceWorld();
  keepAlive.activateEmbedSurfaceForTab.call(ctx, embed, "t-missing");
  assert(live.hasClass("mwv-parked-frame") && parked.hasClass("mwv-parked-frame"), "a frame stayed live for a tab that has none");
  assert(embed.querySelectorAll(".mwv-live-frame").length === 0, "exactly zero live frames expected");
  return "all frames parked; renderLiveBrowserSurface will mount a fresh guest";
});

check("tab keep-alive: the pool evicts the oldest parked surfaces beyond the cap", () => {
  const { embed, ctx, doc, calls } = createSurfaceWorld();
  const liveBrowser = embed.querySelector(":scope > .mwv-live-browser");
  for (let i = 0; i < 5; i += 1) {
    const frame = doc.createElement("webview");
    frame.className = "mwv-parked-frame";
    frame.dataset.mwvSurfaceTabId = `old-${i}`;
    frame.dataset.mwvSurfaceActiveAt = String(1000 + i);
    liveBrowser.appendChild(frame);
  }
  // 6 parked (t2@200 + old-0..4) + the incoming live one = 7 against a cap of
  // 5 → the two oldest (t2, old-0) must go, recency order preserved below.
  keepAlive.evictParkedEmbedSurfaces.call(ctx, liveBrowser);
  const left = Array.from(liveBrowser.querySelectorAll(":scope > .mwv-parked-frame"));
  assert(left.length === 4, `expected the cap to keep 4 parked, got ${left.length}`);
  assert(!left.some((f) => f.dataset.mwvSurfaceTabId === "t2"), "the stalest parked surface survived eviction");
  assert(!left.some((f) => f.dataset.mwvSurfaceTabId === "old-0"), "the second-stalest parked surface survived eviction");
  assert(calls.disposed.some((n) => n.dataset?.mwvSurfaceTabId === "t2"), "the evicted surface was not disposed");
  return `pool capped: 2 stalest disposed, ${left.length} parked remain`;
});

check("tab keep-alive: closing the active tab hands the surface to a preserved successor", () => {
  const { embed, live, parked, calls, ctx } = createSurfaceWorld();
  keepAlive.adoptEmbedSurfaceForSuccessor.call(ctx, embed, "t1", "t2");
  assert(parked.hasClass("mwv-live-frame"), "the successor's preserved surface did not go live");
  assert(!live.isConnected, "the closed tab's surface was not freed");
  assert(calls.disposed.includes(live), "the closed tab's renderer was not disposed");
  assert(live.dataset.mwvSurfaceTabId === "t1" && !embed.querySelector('[data-mwv-surface-tab-id="t1"]'), "the closed tab's surface lingered");
  return "successor promoted, closed surface disposed";
});

check("tab keep-alive: closing the active tab with no preserved successor adopts the surviving guest", () => {
  const { embed, ctx, win, doc, calls } = createSurfaceWorld();
  const liveBrowser = embed.querySelector(":scope > .mwv-live-browser");
  liveBrowser.querySelector(':scope > [data-mwv-surface-tab-id="t2"]').remove();
  const live = liveBrowser.querySelector(":scope > .mwv-live-frame");
  keepAlive.adoptEmbedSurfaceForSuccessor.call(ctx, embed, "t1", "t2");
  assert(live.isConnected, "the surviving guest was destroyed");
  assert(live.dataset.mwvSurfaceTabId === "t2", "the surviving guest was not re-owned by the successor");
  assert(live.hasClass("mwv-live-frame"), "the adopted guest lost the live surface role");
  return "guest re-owned by the successor; the following navigation drives it";
});

check("tab keep-alive: closing a background tab frees its parked renderer", () => {
  const { embed, parked, calls, ctx } = createSurfaceWorld();
  keepAlive.destroyEmbedSurfaceForTab.call(ctx, embed, "t2");
  assert(!parked.isConnected, "the background tab's surface was not removed");
  assert(calls.disposed.includes(parked), "the background renderer was not disposed");
  return "background surface disposed and removed";
});

check("tab keep-alive: parked-surface events are recorded onto their own tab", () => {
  const { parked, calls, ctx } = createSurfaceWorld();
  keepAlive.recordParkedSurfaceNavigation.call(ctx, parked, "https://next.example/page");
  keepAlive.recordParkedSurfaceNavigation.call(ctx, parked, "about:blank");
  keepAlive.recordParkedSurfaceTitle.call(ctx, parked, "Next Page");
  assert(calls.tabPatches.length === 2, `expected 2 patches, got ${calls.tabPatches.length}`);
  assert(calls.tabPatches[0][0] === "t2" && calls.tabPatches[0][1].url === "https://next.example/page", "the navigation patch hit the wrong tab");
  assert(calls.tabPatches[1][0] === "t2" && calls.tabPatches[1][1].title === "Next Page", "the title patch hit the wrong tab");
  return "background navigation/title land on the owning tab record; about:blank ignored";
});

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

let failed = 0;
const settled = [];
for (const r of results) {
  if (!r.promise) { settled.push(r); continue; }
  try {
    settled.push({ label: r.label, ok: true, detail: await r.promise });
  } catch (error) {
    settled.push({ label: r.label, ok: false, detail: String(error && error.message ? error.message : error) });
  }
}
for (const r of settled) {
  if (r.ok) {
    console.log(`PASS ${r.label} — ${r.detail}`);
  } else {
    failed += 1;
    console.log(`FAIL ${r.label}\n     ${r.detail}`);
  }
}
if (failed) {
  console.log(`\nBrowser control verification failed: ${failed}/${settled.length}`);
  process.exitCode = 1;
} else {
  console.log(`\nBrowser control verification passed (${settled.length}/${settled.length}).`);
}
