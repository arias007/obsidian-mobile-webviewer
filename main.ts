import {
  App,
  Component,
  ItemView,
  MarkdownRenderer,
  Menu,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  requestUrl,
  sanitizeHTMLToDom,
  Setting,
  SuggestModal,
  TFile,
  WorkspaceLeaf,
  normalizePath,
  setIcon,
  type SettingDefinitionItem,
  type IconName
} from "obsidian";
import * as qrcodeFactory from "qrcode-generator";

const VIEW_TYPE = "mobile-webviewer-view";
const MOBILE_WEBVIEWER_API_VERSION = "1.0.0";
const DEFAULT_HOME = "https://www.bing.com/";
const DEFAULT_SEARCH = "https://www.bing.com/search?q={{query}}";
const WEBVIEW_NOTE_PATH = "Mobile Webviewer.md";
const BING_RESULTS_PER_PAGE = 10;
const BING_DEFAULT_PAGES = 3;
const BING_DEFAULT_MAX_RESULTS = 24;
const MAX_HISTORY = 80;
const MAX_BOOKMARKS = 120;
const MAX_READING_LIST = 120;
const MAX_CACHE_ENTRIES = 40;
const MAX_CONSOLE_ENTRIES = 120;
const MAX_BROWSER_TABS = 16;
const MAX_DOWNLOADS = 120;
const MAX_WEB_NOTES = 500;
const DEFAULT_DOWNLOAD_FOLDER = "Mobile Webviewer Downloads";
const DEFAULT_WEB_NOTE_FOLDER = "Mobile Webviewer Notes";
const DEFAULT_DOWNLOAD_CONNECTIONS = 4;
const MIN_SEGMENTED_DOWNLOAD_BYTES = 2 * 1024 * 1024;
const MAX_MHTML_RESOURCES = 24;
const DEFAULT_TRANSLATE_TARGET = "ob";
const DEFAULT_UI_LANGUAGE = "auto";
const BINARY_URL_PATTERN = /\.(zip|7z|rar|exe|msi|apk|dmg|pkg|pdf|docx?|xlsx?|pptx?|mp[34]|m4a|wav|flac|jpg|jpeg|png|gif|webp|svg|torrent)([?#].*)?$/i;
const INVALID_FILE_NAME_CHARS = new Set(["<", ">", ":", "\"", "/", "\\", "|", "?", "*"]);
const NOTEDRAW_BUTTON_SELECTOR = ".notedraw-header-button, .notedraw-webview-button, .notedraw-fallback-button, .notedraw-webview-inline-button";
const MWV_DEDUPE_ROOT_SELECTOR = ".mwv-root, .mwv-note-embed, .mwv-embed";
const NOTE_BROWSER_STARTUP_DEFAULT_VERSION = "0.3.53";
const NOTEDRAW_LEGACY_WEBVIEWER_MIGRATION_VERSION = 3;
const AD_CANDIDATE_SELECTOR = [
  "[id='ad' i]",
  "[id^='ad-' i]",
  "[id^='ad_' i]",
  "[id$='-ad' i]",
  "[id$='_ad' i]",
  "[id*='-ad-' i]",
  "[id*='_ad_' i]",
  "[class~='ad' i]",
  "[class~='ads' i]",
  "[class^='ad-' i]",
  "[class^='ad_' i]",
  "[class^='ads-' i]",
  "[class^='ads_' i]",
  "[class*=' ad-' i]",
  "[class*=' ad_' i]",
  "[class*=' ads-' i]",
  "[class*=' ads_' i]",
  "[class*='advert' i]",
  "[id*='sponsor' i]",
  "[class*='sponsor' i]",
  "[id*='promo' i]",
  "[class*='promo' i]",
  "[data-ad]",
  "[data-ads]",
  "[data-ad-client]",
  "[data-ad-slot]",
  "iframe[src*='ad' i]",
  "iframe[src*='doubleclick' i]",
  "iframe[src*='googlesyndication' i]",
  "iframe[src*='adservice' i]",
  "[aria-label*='advert' i]",
  "[aria-label*='sponsor' i]",
  "ins.adsbygoogle"
].join(",");

type UtilityPageKind = "bookmarks" | "history" | "reading" | "downloads" | "console" | "cancip";
const MWV_INTERNAL_SCHEME = "mwv://";
const UTILITY_PAGE_KINDS: UtilityPageKind[] = ["bookmarks", "history", "reading", "downloads", "console", "cancip"];

// Bridge injected into proxied live pages (sandboxed srcdoc without
// allow-same-origin). It keeps navigation inside Mobile Webviewer, reports
// titles/console, and implements find-in-page. Plain ES5, no template
// literals, so it is safe to embed in any generated document.
const MWV_PROXY_BRIDGE_SOURCE = [
  "(function(){",
  "if (window.__mwvProxyBridge) return;",
  "window.__mwvProxyBridge = true;",
  "var BASE = (document.querySelector('base') || {}).href || location.href;",
  "function abs(u){ try { return new URL(u, BASE).href; } catch (e) { return u; } }",
  "function isHttp(u){ return /^https?:/i.test(u || ''); }",
  "function send(kind, extra){ var msg = extra || {}; msg.mwvBridge = kind; try { parent.postMessage(msg, '*'); } catch (e) {} }",
  "document.addEventListener('click', function(ev){",
  "  var node = ev.target;",
  "  var a = node && node.closest ? node.closest('a[href]') : null;",
  "  if (!a) return;",
  "  var href = a.getAttribute('href') || '';",
  "  if (!href || href.charAt(0) === '#' || /^javascript:/i.test(href)) return;",
  "  var url = abs(href);",
  "  var target = (a.getAttribute('target') || '').toLowerCase();",
  "  if (target === '_blank' || target === '_top' || a.hasAttribute('download')) { ev.preventDefault(); send('new-window', {url: url}); return; }",
  "  if (isHttp(url)) { ev.preventDefault(); send('navigate', {url: url}); }",
  "}, true);",
  "document.addEventListener('submit', function(ev){",
  "  var form = ev.target;",
  "  if (!form || !form.tagName || form.tagName.toUpperCase() !== 'FORM') return;",
  "  var method = (form.getAttribute('method') || 'get').toUpperCase();",
  "  var action = abs(form.getAttribute('action') || BASE);",
  "  if (method === 'GET') {",
  "    ev.preventDefault();",
  "    try {",
  "      var fd = new FormData(form);",
  "      var qs = new URLSearchParams();",
  "      fd.forEach(function(v, k){ if (typeof v === 'string') qs.append(k, v); });",
  "      var q = qs.toString();",
  "      send('navigate', {url: q ? action + (action.indexOf('?') >= 0 ? '&' : '?') + q : action});",
  "    } catch (e) { send('navigate', {url: action}); }",
  "  } else {",
  "    ev.preventDefault();",
  "    try {",
  "      var fd2 = new FormData(form);",
  "      var entries = [];",
  "      fd2.forEach(function(v, k){ if (typeof v === 'string') entries.push([k, v]); });",
  "      send('post-form', {url: action, entries: entries});",
  "    } catch (e) { send('post-unsupported', {url: action}); }",
  "  }",
  "}, true);",
  "window.open = function(u){ if (u) send('new-window', {url: abs(String(u))}); return null; };",
  "function reportTitle(){ send('title', {title: document.title || ''}); }",
  "document.addEventListener('DOMContentLoaded', reportTitle);",
  "window.addEventListener('load', reportTitle);",
  "try {",
  "  var titleEl = document.head ? document.head.querySelector('title') : null;",
  "  if (titleEl) new MutationObserver(reportTitle).observe(titleEl, {childList: true, characterData: true, subtree: true});",
  "} catch (e) {}",
  "window.addEventListener('error', function(ev){ send('console', {level: 'error', message: (ev.message || 'Script error') + (ev.filename ? ' @ ' + ev.filename.split('/').pop() + ':' + (ev.lineno || 0) : '')}); });",
  "var findCursor = -1;",
  "function clearFind(){",
  "  var marks = document.querySelectorAll('mark[data-mwv-find]');",
  "  for (var i = marks.length - 1; i >= 0; i--) {",
  "    var m = marks[i]; var p = m.parentNode;",
  "    if (p) { p.replaceChild(document.createTextNode(m.textContent || ''), m); try { p.normalize(); } catch (e) {} }",
  "  }",
  "  findCursor = -1;",
  "}",
  "function findInPage(query, dir, requestId){",
  "  clearFind();",
  "  if (!query) { send('find-result', {requestId: requestId, count: 0, index: 0}); return; }",
  "  var lower = query.toLowerCase();",
  "  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {acceptNode: function(n){",
  "    if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;",
  "    var p = n.parentNode;",
  "    if (p && p.nodeName && /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|MARK)$/.test(p.nodeName)) return NodeFilter.FILTER_REJECT;",
  "    return NodeFilter.FILTER_ACCEPT;",
  "  }});",
  "  var nodes = []; var n;",
  "  while ((n = walker.nextNode())) nodes.push(n);",
  "  for (var i = 0; i < nodes.length; i++) {",
  "    var node = nodes[i]; var text = node.nodeValue; var tl = text.toLowerCase();",
  "    if (tl.indexOf(lower) < 0) continue;",
  "    var frag = document.createDocumentFragment();",
  "    var pos = 0, hit;",
  "    while ((hit = tl.indexOf(lower, pos)) >= 0) {",
  "      if (hit > pos) frag.appendChild(document.createTextNode(text.slice(pos, hit)));",
  "      var mark = document.createElement('mark');",
  "      mark.setAttribute('data-mwv-find', '');",
  "      mark.style.background = '#ffd54f'; mark.style.color = '#000';",
  "      mark.textContent = text.substr(hit, query.length);",
  "      frag.appendChild(mark);",
  "      pos = hit + query.length;",
  "    }",
  "    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));",
  "    if (node.parentNode) node.parentNode.replaceChild(frag, node);",
  "  }",
  "  var marks = document.querySelectorAll('mark[data-mwv-find]');",
  "  var total = marks.length; var index = -1;",
  "  if (total) {",
  "    index = dir >= 0 ? (findCursor < 0 ? 0 : (findCursor + 1) % total) : (findCursor < 0 ? total - 1 : (findCursor - 1 + total) % total);",
  "    findCursor = index;",
  "    try { marks[index].scrollIntoView({block: 'center', behavior: 'smooth'}); } catch (e) {}",
  "  }",
  "  send('find-result', {requestId: requestId, count: total, index: index + 1});",
  "}",
  "window.addEventListener('message', function(ev){",
  "  if (ev.source !== window.parent) return;",
  "  var data = ev.data;",
  "  if (!data || typeof data !== 'object') return;",
  "  if (data.mwvFetchResult && typeof data.requestId === 'number') { resolveFetch(data.requestId, data); return; }",
  "  if (typeof data.mwvFind === 'string') findInPage(data.mwvFind, data.mwvDir >= 0 ? 1 : -1, data.requestId);",
  "  else if (data.mwvClearFind) clearFind();",
  "});",
  "var INIT = window.__mwvInit || {};",
  "var cook = {};",
  "(function(){ var seed = INIT.cookies || {}; for (var k in seed) cook[k] = String(seed[k]); })();",
  "try {",
  "  Object.defineProperty(document, 'cookie', {",
  "    configurable: true,",
  "    get: function(){ var out = []; for (var n in cook) out.push(n + '=' + cook[n]); return out.join('; '); },",
  "    set: function(v){",
  "      if (typeof v !== 'string' || !v) return;",
  "      var parts = v.split(';'); var kv = parts[0]; var eq = kv.indexOf('=');",
  "      if (eq <= 0) return;",
  "      var name = kv.slice(0, eq).trim(); var val = kv.slice(eq + 1).trim();",
  "      if (!name) return;",
  "      if (val === '' || /expires=Thu, 01 Jan 1970/i.test(v) || /max-age=0/i.test(v)) delete cook[name];",
  "      else cook[name] = val;",
  "      send('cookie-set', {raw: v});",
  "    }",
  "  });",
  "} catch (e) {}",
  "function makeStore(kind, seed){",
  "  var d = {}; for (var k in (seed || {})) d[k] = String(seed[k]);",
  "  return {",
  "    getItem: function(k){ return Object.prototype.hasOwnProperty.call(d, String(k)) ? d[String(k)] : null; },",
  "    setItem: function(k, v){ d[String(k)] = String(v); send('storage-set', {kind: kind, key: String(k), value: String(v)}); },",
  "    removeItem: function(k){ delete d[String(k)]; send('storage-set', {kind: kind, key: String(k), value: null}); },",
  "    clear: function(){ d = {}; send('storage-set', {kind: kind, key: '__mwv_clear__', value: null}); },",
  "    key: function(i){ var ks = Object.keys(d); return i >= 0 && i < ks.length ? ks[i] : null; },",
  "    get length(){ return Object.keys(d).length; }",
  "  };",
  "}",
  "try { Object.defineProperty(window, 'localStorage', { configurable: true, get: function(){ if (!window.__mwvLocal) window.__mwvLocal = makeStore('local', INIT.storage || {}); return window.__mwvLocal; } }); } catch (e) {}",
  "try { Object.defineProperty(window, 'sessionStorage', { configurable: true, get: function(){ if (!window.__mwvSession) window.__mwvSession = makeStore('session', {}); return window.__mwvSession; } }); } catch (e) {}",
  "var fseq = 0; var fpending = {};",
  "function resolveFetch(id, data){ var p = fpending[id]; if (!p) return; delete fpending[id]; p(data); }",
  "function hostRequest(opts){ return new Promise(function(res){ var id = ++fseq; fpending[id] = res; send('fetch', {requestId: id, url: opts.url, method: opts.method || 'GET', headers: opts.headers || {}, body: typeof opts.body === 'string' ? opts.body : ''}); }); }",
  "function headersToObject(h){",
  "  var out = {}; if (!h) return out;",
  "  if (typeof h.forEach === 'function') { h.forEach(function(v, k){ out[k] = v; }); return out; }",
  "  if (Array.isArray(h)) { h.forEach(function(kv){ out[kv[0]] = kv[1]; }); return out; }",
  "  for (var k in h) out[k] = h[k]; return out;",
  "}",
  "function bodyToString(b){",
  "  if (b == null) return '';",
  "  if (typeof b === 'string') return b;",
  "  try { if (typeof URLSearchParams !== 'undefined' && b instanceof URLSearchParams) return b.toString(); } catch (e) {}",
  "  try { if (typeof FormData !== 'undefined' && b instanceof FormData) { var qs = new URLSearchParams(); b.forEach(function(v, k){ if (typeof v === 'string') qs.append(k, v); }); return qs.toString(); } } catch (e) {}",
  "  try { return JSON.stringify(b); } catch (e) { return ''; }",
  "}",
  "if (typeof window.fetch === 'function') {",
  "  window.fetch = function(input, init){",
  "    try {",
  "      var url = typeof input === 'string' ? input : (input && input.url) || '';",
  "      var reqHeaders = headersToObject((init && init.headers) || (input && input.headers));",
  "      var method = (init && init.method) || (input && input.method) || 'GET';",
  "      var body = bodyToString(init && init.body);",
  "      if (body && !reqHeaders['content-type'] && !reqHeaders['Content-Type']) reqHeaders['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';",
  "      return hostRequest({url: abs(url), method: method, headers: reqHeaders, body: body}).then(function(d){",
  "        var bodyText = d.body || '';",
  "        try { return new Response(bodyText, { status: d.status || 200, statusText: d.statusText || '', headers: d.headers || {} }); }",
  "        catch (e) { return { ok: (d.status || 200) >= 200 && (d.status || 200) < 300, status: d.status || 200, statusText: d.statusText || '', url: url, headers: { get: function(k){ return (d.headers || {})[String(k).toLowerCase()] || null; }, forEach: function(cb){ var hh = d.headers || {}; for (var k in hh) cb(hh[k], k); } }, text: function(){ return Promise.resolve(bodyText); }, json: function(){ try { return Promise.resolve(JSON.parse(bodyText)); } catch (err) { return Promise.reject(err); } } }; }",
  "      });",
  "    } catch (e) { return Promise.reject(e); }",
  "  };",
  "}",
  "function MwvXhr(){ this.readyState = 0; this.status = 0; this.statusText = ''; this.response = ''; this.responseText = ''; this.responseType = ''; this.withCredentials = false; this._headers = {}; this._respHeaders = {}; this._listeners = {}; }",
  "MwvXhr.prototype.open = function(m, u){ this._method = (m || 'GET').toUpperCase(); this._url = abs(String(u || '')); this.readyState = 1; };",
  "MwvXhr.prototype.setRequestHeader = function(k, v){ this._headers[String(k).toLowerCase()] = String(v); };",
  "MwvXhr.prototype.getAllResponseHeaders = function(){ var out = ''; for (var k in this._respHeaders) out += k + ': ' + this._respHeaders[k] + '\\r\\n'; return out; };",
  "MwvXhr.prototype.getResponseHeader = function(k){ return this._respHeaders[String(k).toLowerCase()] || null; };",
  "MwvXhr.prototype.abort = function(){};",
  "MwvXhr.prototype.addEventListener = function(t, fn){ (this._listeners[t] = this._listeners[t] || []).push(fn); };",
  "MwvXhr.prototype.removeEventListener = function(t, fn){ var a = this._listeners[t] || []; var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };",
  "MwvXhr.prototype._fire = function(t){ var ev = { target: this, currentTarget: this, type: t }; var a = (this._listeners[t] || []).slice(0); for (var i = 0; i < a.length; i++) { try { a[i](ev); } catch (e) {} } };",
  "MwvXhr.prototype.send = function(body){",
  "  var self = this;",
  "  self.readyState = 2;",
  "  self._fire('readystatechange');",
  "  hostRequest({url: self._url, method: self._method, headers: self._headers, body: bodyToString(body)}).then(function(d){",
  "    self.status = d.status || 200; self.statusText = d.statusText || ''; self._respHeaders = d.headers || {};",
  "    var bodyText = d.body || '';",
  "    self.responseText = bodyText;",
  "    self.response = self.responseType === 'json' ? (function(){ try { return JSON.parse(bodyText); } catch (e) { return null; } })() : bodyText;",
  "    self.readyState = 4;",
  "    self._fire('readystatechange');",
  "    if (typeof self.onreadystatechange === 'function') { try { self.onreadystatechange({ target: self, currentTarget: self }); } catch (e) {} }",
  "    self._fire('load');",
  "    if (typeof self.onload === 'function') { try { self.onload({ target: self, currentTarget: self }); } catch (e) {} }",
  "  }, function(){ self.status = 0; self.readyState = 4; self._fire('error'); if (typeof self.onerror === 'function') { try { self.onerror({ target: self }); } catch (e) {} } });",
  "};",
  "window.XMLHttpRequest = MwvXhr;",
  "reportTitle();",
  "})();"
].join("\n");

const FOLLOW_OBSIDIAN_TRANSLATE_OPTION: LanguageOption = {
  code: "ob",
  label: "Follow Obsidian language",
  native: "跟随 Obsidian 语言"
};

const FOLLOW_OBSIDIAN_UI_OPTION: LanguageOption = {
  code: DEFAULT_UI_LANGUAGE,
  label: "Follow Obsidian language",
  native: "跟随 Obsidian 语言"
};

const TRANSLATE_LANGUAGES: LanguageOption[] = [
  { code: "zh-Hans", label: "Chinese Simplified", native: "简体中文" },
  { code: "zh-Hant", label: "Chinese Traditional", native: "繁體中文" },
  { code: "en", label: "English", native: "English" },
  { code: "ug", label: "Uyghur", native: "ئۇيغۇرچە" },
  { code: "ar", label: "Arabic", native: "العربية" },
  { code: "ru", label: "Russian", native: "Русский" },
  { code: "tr", label: "Turkish", native: "Türkçe" },
  { code: "ja", label: "Japanese", native: "日本語" },
  { code: "ko", label: "Korean", native: "한국어" },
  { code: "fr", label: "French", native: "Français" },
  { code: "de", label: "German", native: "Deutsch" },
  { code: "es", label: "Spanish", native: "Español" },
  { code: "pt", label: "Portuguese", native: "Português" },
  { code: "it", label: "Italian", native: "Italiano" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "fa", label: "Persian", native: "فارسی" },
  { code: "ur", label: "Urdu", native: "اردو" },
  { code: "kk", label: "Kazakh", native: "Қазақша" },
  { code: "ky", label: "Kyrgyz", native: "Кыргызча" },
  { code: "uz", label: "Uzbek", native: "O'zbekcha" },
  { code: "id", label: "Indonesian", native: "Indonesia" },
  { code: "ms", label: "Malay", native: "Melayu" },
  { code: "th", label: "Thai", native: "ไทย" },
  { code: "vi", label: "Vietnamese", native: "Tiếng Việt" }
];

const TRANSLATE_CHOICES: LanguageOption[] = [FOLLOW_OBSIDIAN_TRANSLATE_OPTION, ...TRANSLATE_LANGUAGES];
const UI_LANGUAGE_CHOICES: LanguageOption[] = [FOLLOW_OBSIDIAN_UI_OPTION, ...TRANSLATE_LANGUAGES];
const SUPPORT_CODE_ASSETS = [
  { path: "extras/code-1.jpg", label: "支付宝 / Alipay" },
  { path: "extras/code-2.png", label: "币安 / Binance" }
];

interface WebEntry {
  title: string;
  url: string;
  time: number;
}

interface BrowserTab {
  id: string;
  title: string;
  url: string;
  back: string[];
  forward: string[];
  time: number;
}

interface MobileWebviewerTabSummary {
  id: string;
  title: string;
  url: string;
  active: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  updatedAt: number;
}

interface UserScriptRule {
  id: string;
  name: string;
  match: string;
  enabled: boolean;
  css: string;
  js: string;
  runAt: "reader";
  time: number;
}

interface DownloadEntry {
  id: string;
  url: string;
  fileName: string;
  path: string;
  mime: string;
  status: "queued" | "downloading" | "completed" | "error";
  format: "file" | "html" | "mhtml";
  bytesReceived: number;
  bytesTotal: number;
  progress: number;
  connections: number;
  resumable: boolean;
  message: string;
  time: number;
}

interface BrowserWebTextEdit {
  kind: "text";
  path: string;
  originalText: string;
  editedText: string;
  updatedAt: string;
}

interface WebNoteEntry {
  id: string;
  url: string;
  title: string;
  sourceTitle: string;
  noteHtml: string;
  noteText: string;
  doodleSvg: string;
  pageHtml: string;
  pageText: string;
  pageEdits: BrowserWebTextEdit[];
  markdownPath: string;
  updatedAt: number;
  createdAt: number;
}

interface LanguageOption {
  code: string;
  label: string;
  native: string;
}

type UiTextKey =
  | "uiLanguage"
  | "uiLanguageDesc"
  | "followObsidian"
  | "coreEntry"
  | "coreEntryDesc"
  | "homePage"
  | "homePageDesc"
  | "searchUrl"
  | "searchUrlDesc"
  | "noteBrowserCurrentUrl"
  | "noteBrowserCurrentUrlDesc"
  | "openBrowser"
  | "openBrowserDesc"
  | "openOnStartup"
  | "openOnStartupDesc"
  | "interfaceRendering"
  | "interfaceRenderingDesc"
  | "compactMobileToolbar"
  | "compactMobileToolbarDesc"
  | "showNoteDrawMagicWand"
  | "showNoteDrawMagicWandDesc"
  | "readerHint"
  | "readerHintDesc"
  | "liveBrowserFirst"
  | "liveBrowserFirstDesc"
  | "frontendMode"
  | "frontendModeDesc"
  | "editableNote"
  | "fullWebPage"
  | "autoSaveWebNotes"
  | "autoSaveWebNotesDesc"
  | "webNoteFolder"
  | "webNoteFolderDesc"
  | "pageZoom"
  | "pageZoomDesc"
  | "readerFontSize"
  | "readerFontSizeDesc"
  | "desktopView"
  | "desktopViewDesc"
  | "userAgent"
  | "userAgentDesc"
  | "mobile"
  | "desktop"
  | "download"
  | "downloadDesc"
  | "downloadFolder"
  | "downloadFolderDesc"
  | "downloadConnections"
  | "downloadConnectionsDesc"
  | "browserMode"
  | "browserModeDesc"
  | "nightMode"
  | "nightModeDesc"
  | "eyeProtection"
  | "eyeProtectionDesc"
  | "adBlock"
  | "adBlockDesc"
  | "markAds"
  | "markAdsDesc"
  | "incognito"
  | "incognitoDesc"
  | "disableJavaScript"
  | "disableJavaScriptDesc"
  | "rotateScreen"
  | "rotateScreenDesc"
  | "dataImportExport"
  | "dataImportExportDesc"
  | "universalExport"
  | "universalExportDesc"
  | "exportJson"
  | "copyJson"
  | "universalImport"
  | "universalImportDesc"
  | "importClipboard"
  | "translation"
  | "translationDesc"
  | "defaultTranslationLanguage"
  | "defaultTranslationLanguageDesc"
  | "scriptsReader"
  | "scriptsReaderDesc"
  | "readerUserScripts"
  | "readerUserScriptsDesc"
  | "readerCss"
  | "readerCssDesc"
  | "readerJavascript"
  | "readerJavascriptDesc"
  | "userScriptRules"
  | "rulesCount"
  | "rulesDesc"
  | "addRule"
  | "ruleName"
  | "delete"
  | "match"
  | "matchDesc"
  | "css"
  | "cssDesc"
  | "javascript"
  | "javascriptDesc"
  | "autofill"
  | "autofillDesc"
  | "autofillName"
  | "autofillEmail"
  | "autofillPhone"
  | "autofillAddress"
  | "autofillFieldDesc"
  | "dataMaintenance"
  | "dataMaintenanceDesc"
  | "clearHistory"
  | "clearReaderCache"
  | "clearDownloads"
  | "readingList"
  | "clearConsole"
  | "clearBrowsingData"
  | "clearBrowsingDataDesc"
  | "exportBookmarkNote"
  | "exportBookmarkNoteDesc"
  | "clear"
  | "create"
  | "savedEntries"
  | "cachedPages"
  | "downloadRecords"
  | "savedPages"
  | "consoleEntries"
  | "supportCodes"
  | "supportCodesDesc"
  | "searchOrEnterUrl"
  | "go"
  | "more"
  | "closeMore"
  | "ready"
  | "bookmarks"
  | "history"
  | "reading"
  | "downloads"
  | "console"
  | "closePanel"
  | "back"
  | "forward"
  | "reload"
  | "home"
  | "note"
  | "web"
  | "noteBrowser"
  | "saveMd"
  | "bookmark"
  | "saveLink"
  | "settings"
  | "noBookmarksYet"
  | "noReadingListYet"
  | "noHistoryYet"
  | "noDownloadsYet"
  | "noConsoleLogs"
  | "search"
  | "searchBing"
  | "searching"
  | "searchingBing"
  | "resultsCount"
  | "moreResults"
  | "loading"
  | "loadFailedRetry"
  | "nativeLightHome"
  | "reader"
  | "readingStatus"
  | "pageTools"
  | "copyLink"
  | "doodle"
  | "closeDoodle"
  | "editableWebNote"
  | "links"
  | "autoSavedPlugin"
  | "saving"
  | "savedPlugin"
  | "savedMarkdown"
  | "webNoteSaved"
  | "savedTo"
  | "bookmarkAdded"
  | "bookmarkRemoved"
  | "noPreviousPage"
  | "noNextPage"
  | "internalBrowserTab"
  | "refresh"
  | "openCancip"
  | "all"
  | "completed"
  | "failed"
  | "today"
  | "latest"
  | "noEntries"
  | "open"
  | "copy"
  | "downloadState"
  | "openFile"
  | "copyPath"
  | "location"
  | "source"
  | "cancipDetected"
  | "cancipNotEnabled"
  | "cancipDetectedDesc"
  | "cancipNotEnabledDesc"
  | "copyCurrentContext"
  | "sendCurrentToCancip"
  | "sentCurrentToCancip"
  | "cancipContextPrompt"
  | "copiedCancipContext"
  | "downloadComplete"
  | "newTab"
  | "openLink"
  | "openInNewTab"
  | "downloadLink"
  | "downloadSavedTo"
  | "tabs"
  | "page"
  | "view"
  | "save"
  | "tools"
  | "downloadPage"
  | "bookmarksCount"
  | "historyCount"
  | "readingCount"
  | "consoleCount"
  | "downloadsCount"
  | "newObTab"
  | "openNoteWeb"
  | "openInBrowser"
  | "share"
  | "browserStatus"
  | "zoomIn"
  | "zoomOut"
  | "mobileVersion"
  | "desktopVersion"
  | "dayMode"
  | "closeEyeProtection"
  | "closeAdBlock"
  | "adBlocking"
  | "unmarkAds"
  | "closeIncognito"
  | "exitFullscreen"
  | "fullscreen"
  | "enableJs"
  | "disableJs"
  | "closeLandscape"
  | "landscape"
  | "fontSize"
  | "downloadFile"
  | "saveHtml"
  | "saveMht"
  | "offlinePage"
  | "desktopShortcut"
  | "removeBookmark"
  | "addBookmark"
  | "addReadingList"
  | "autofillPage"
  | "scriptsCount"
  | "mediaSniff"
  | "pageAssets"
  | "copySource"
  | "viewSource"
  | "translateAction"
  | "readAloud"
  | "qrCode"
  | "report"
  | "copyLogs"
  | "clearCache"
  | "siteSettings"
  | "toolStatus"
  | "clearBrowsingDataAction"
  | "runningAction"
  | "completedAction"
  | "failedAction"
  | "downloadFinished"
  | "saved"
  | "addedReadingList"
  | "mediaCopied"
  | "resourcesCopied"
  | "sourceCopied"
  | "consoleCopied"
  | "cacheCleared"
  | "browsingDataCleared"
  | "translatePageTo"
  | "newObsidianTab"
  | "address"
  | "webResultsTab"
  | "imageResultsTab"
  | "videoResultsTab"
  | "academicTab"
  | "dictionaryTab"
  | "mapsTab"
  | "moreTab"
  | "aboutResults"
  | "learnMoreAbout"
  | "webNotePlaceholder"
  | "fallbackEditableNote"
  | "loadingValue"
  | "yes"
  | "no"
  | "downloadDirectory"
  | "copiedLink"
  | "cancipAi"
  | "currentOpen"
  | "readerExtracting"
  | "insertedLink"
  | "copiedMarkdownLink"
  | "noteDrawDisabled"
  | "readerNoteNotReady"
  | "noWebNoteToExport"
  | "jsonCopied"
  | "clipboardEmpty"
  | "fileMissingPathCopied"
  | "htmlSaveFailed"
  | "mhtSaveFailed"
  | "shareTextCopied"
  | "downloadFailed"
  | "cancipDisabled"
  | "noWebLinkFound"
  | "bookmarkNoteCreated"
  | "emptyConsoleDesc"
  | "pageSource"
  | "copyReport"
  | "reportUrl"
  | "reportCopied"
  | "urlCopied"
  | "translatePage"
  | "noSavedPages"
  | "noResourcesFound"
  | "disabled"
  | "noMatchingScripts"
  | "findInPage"
  | "previous"
  | "next"
  | "close"
  | "pageLoadLimited"
  | "systemBrowser"
  | "proxyModeActive"
  | "postFormUnsupported"
  | "clearCookies"
  | "cookiesCleared";

type UiDictionary = Partial<Record<UiTextKey, string>>;

const UI_TEXT_EN: Record<UiTextKey, string> = {
  uiLanguage: "Interface language",
  uiLanguageDesc: "Default follows Obsidian/system language. You can also pin a fixed language for this plugin.",
  followObsidian: "Follow Obsidian language",
  coreEntry: "Core entry",
  coreEntryDesc: "Home page, search, browser entries, and startup behavior.",
  homePage: "Home page",
  homePageDesc: "Default page opened by the home button.",
  searchUrl: "Search URL",
  searchUrlDesc: "Use {{query}} as the encoded search text placeholder.",
  noteBrowserCurrentUrl: "Note Browser current URL",
  noteBrowserCurrentUrlDesc: "The URL restored when opening the note-based browser.",
  openBrowser: "Open browser",
  openBrowserDesc: "Quickly open the note-based browser from settings.",
  openOnStartup: "Open on startup",
  openOnStartupDesc: "Open the note-based browser in reading view after Obsidian layout is ready.",
  interfaceRendering: "Interface and rendering",
  interfaceRenderingDesc: "Control the mobile toolbar, NoteDraw wand, reader layer, and page scale.",
  compactMobileToolbar: "Compact mobile toolbar",
  compactMobileToolbarDesc: "Use smaller controls for phone screens.",
  showNoteDrawMagicWand: "Show NoteDraw magic wand",
  showNoteDrawMagicWandDesc: "Show the wand button in Mobile Webviewer surfaces when NoteDraw is available.",
  readerHint: "Reader hint",
  readerHintDesc: "Show reader-layer hints when the internal browser renders note-like pages.",
  liveBrowserFirst: "Live browser first",
  liveBrowserFirstDesc: "Show the live WebView surface above the note-style reader layer.",
  frontendMode: "Frontend mode",
  frontendModeDesc: "Default foreground: editable note or full web page.",
  editableNote: "Editable note",
  fullWebPage: "Full web page",
  autoSaveWebNotes: "Auto-save web notes",
  autoSaveWebNotesDesc: "Auto-save edited reader text and doodles into plugin data only. Use Save MD to add a Markdown file to the vault.",
  webNoteFolder: "Web note folder",
  webNoteFolderDesc: "Manual Save MD exports are saved here inside the vault.",
  pageZoom: "Page zoom",
  pageZoomDesc: "Default zoom for live browser surfaces.",
  readerFontSize: "Reader font size",
  readerFontSizeDesc: "Reader/cache layer font size.",
  desktopView: "Desktop view",
  desktopViewDesc: "Use a wider live browser surface.",
  userAgent: "User agent",
  userAgentDesc: "Used by internal fetch/search/download requests and the live browser surface where Obsidian exposes control.",
  mobile: "Mobile",
  desktop: "Desktop",
  download: "Download",
  downloadDesc: "Save files, HTML, MHT, and offline pages.",
  downloadFolder: "Download folder",
  downloadFolderDesc: "Files saved by More > Download, HTML, and MHT.",
  downloadConnections: "Download connections",
  downloadConnectionsDesc: "Parallel byte-range connections when the server supports resumable downloads.",
  browserMode: "Browser modes",
  browserModeDesc: "These switches affect Browser View and Note Browser internal rendering.",
  nightMode: "Night mode",
  nightModeDesc: "Darkens internal browser shell and reader surfaces.",
  eyeProtection: "Eye protection",
  eyeProtectionDesc: "Applies a softer reading tint.",
  adBlock: "Ad block",
  adBlockDesc: "Removes common ad containers where the page is accessible.",
  markAds: "Mark ads",
  markAdsDesc: "Marks likely ad containers where the page is accessible.",
  incognito: "Incognito",
  incognitoDesc: "Stops history and reader cache writes.",
  disableJavaScript: "Disable JavaScript",
  disableJavaScriptDesc: "Reloads live pages without allow-scripts in the sandbox.",
  rotateScreen: "Rotate screen",
  rotateScreenDesc: "Uses a wider landscape-like browser surface.",
  dataImportExport: "Data import and export",
  dataImportExportDesc: "Bookmarks, reading list, history, downloads, script rules, web notes, and common settings.",
  universalExport: "Universal export",
  universalExportDesc: "Save a portable Mobile Webviewer JSON package into the download folder.",
  exportJson: "Export JSON",
  copyJson: "Copy JSON",
  universalImport: "Universal import",
  universalImportDesc: "Import Mobile Webviewer JSON, common bookmark HTML, or plain URL lines from the clipboard. Existing data is merged.",
  importClipboard: "Import clipboard",
  translation: "Translation",
  translationDesc: "Default follows Obsidian language, or choose a fixed target language.",
  defaultTranslationLanguage: "Default translation language",
  defaultTranslationLanguageDesc: "Used by More > Translate and the language picker. Follow Obsidian language keeps translation tied to Obsidian's current UI language.",
  scriptsReader: "Scripts and reader layer",
  scriptsReaderDesc: "Reader-layer CSS, JavaScript, and URL-matched script rules.",
  readerUserScripts: "Reader user scripts",
  readerUserScriptsDesc: "Apply custom CSS and JavaScript to the internal reader layer.",
  readerCss: "Reader CSS",
  readerCssDesc: "CSS injected into rendered reader/cache pages.",
  readerJavascript: "Reader JavaScript",
  readerJavascriptDesc: "Runs with container, page, and hostName available.",
  userScriptRules: "User script rules",
  rulesCount: "Rules ({count})",
  rulesDesc: "URL-matched CSS and JavaScript for the internal reader layer.",
  addRule: "Add rule",
  ruleName: "Rule name",
  delete: "Delete",
  match: "Match",
  matchDesc: "Supports substring or wildcard, for example *://*.example.com/*",
  css: "CSS",
  cssDesc: "Injected into matched reader pages.",
  javascript: "JavaScript",
  javascriptDesc: "Runs with container, page, hostName, and rule available.",
  autofill: "Autofill",
  autofillDesc: "Used by More > Autofill page; fills only accessible empty fields.",
  autofillName: "Autofill name",
  autofillEmail: "Autofill email",
  autofillPhone: "Autofill phone",
  autofillAddress: "Autofill address",
  autofillFieldDesc: "Used by More > Autofill page.",
  dataMaintenance: "Data maintenance",
  dataMaintenanceDesc: "Clear browsing history, reader cache, downloads, and console logs.",
  clearHistory: "Clear history",
  clearReaderCache: "Clear reader cache",
  clearDownloads: "Clear downloads",
  readingList: "Reading list",
  clearConsole: "Clear console",
  clearBrowsingData: "Clear browsing data",
  clearBrowsingDataDesc: "Clear history, reader cache, and console entries. Bookmarks, reading list, and files are kept.",
  exportBookmarkNote: "Export bookmark note",
  exportBookmarkNoteDesc: "Create a Markdown note containing current bookmarks.",
  clear: "Clear",
  create: "Create",
  savedEntries: "{count} saved entries.",
  cachedPages: "{count} cached pages.",
  downloadRecords: "{count} saved download records. Files are not removed.",
  savedPages: "{count} saved pages.",
  consoleEntries: "{count} console entries.",
  supportCodes: "Support codes",
  supportCodesDesc: "If this plugin helps you, scan a code to support continued maintenance.",
  searchOrEnterUrl: "Search or enter URL",
  go: "Go",
  more: "More",
  closeMore: "Close More",
  ready: "Ready",
  bookmarks: "Bookmarks",
  history: "History",
  reading: "Reading",
  downloads: "Downloads",
  console: "Console",
  closePanel: "Close panel",
  back: "Back",
  forward: "Forward",
  reload: "Reload",
  home: "Home",
  note: "Note",
  web: "Web",
  noteBrowser: "Note Browser",
  saveMd: "Save MD",
  bookmark: "Bookmark",
  saveLink: "Save link",
  settings: "Settings",
  noBookmarksYet: "No bookmarks yet",
  noReadingListYet: "No reading list yet",
  noHistoryYet: "No history yet",
  noDownloadsYet: "No downloads yet",
  noConsoleLogs: "No console logs",
  search: "Search",
  searchBing: "Search Bing",
  searching: "Searching...",
  searchingBing: "Searching Bing...",
  resultsCount: "{count} result(s)",
  moreResults: "More results",
  loading: "Loading...",
  loadFailedRetry: "Load failed, retry",
  nativeLightHome: "Native light home",
  reader: "Reader",
  readingStatus: "Reading...",
  pageTools: "Page tools",
  copyLink: "Copy link",
  doodle: "Doodle",
  closeDoodle: "Close doodle",
  editableWebNote: "Editable web note",
  links: "Links",
  autoSavedPlugin: "Auto-saved to plugin",
  saving: "Saving...",
  savedPlugin: "Saved to plugin",
  savedMarkdown: "Saved to {path}",
  webNoteSaved: "Web note saved in plugin data",
  savedTo: "Saved to {path}",
  bookmarkAdded: "Bookmark added",
  bookmarkRemoved: "Bookmark removed",
  noPreviousPage: "No previous page",
  noNextPage: "No next page",
  internalBrowserTab: "Internal browser tab",
  refresh: "Refresh",
  openCancip: "Open Cancip",
  all: "All",
  completed: "Completed",
  failed: "Failed",
  today: "Today",
  latest: "Latest",
  noEntries: "No entries",
  open: "Open",
  copy: "Copy",
  downloadState: "{status} · {progress}%",
  openFile: "Open",
  copyPath: "Copy path",
  location: "Location",
  source: "Source",
  cancipDetected: "Cancip AI detected",
  cancipNotEnabled: "Cancip AI is not enabled",
  cancipDetectedDesc: "Version {version}; open the AI panel from here.",
  cancipNotEnabledDesc: "After installing or enabling Cancip, Mobile Webviewer can provide the current web context as an AI entry.",
  copyCurrentContext: "Copy current web context",
  sendCurrentToCancip: "Send current page to Cancip",
  sentCurrentToCancip: "Current page added to Cancip",
  cancipContextPrompt: "Use this web context to analyze, organize, excerpt, or generate notes.",
  copiedCancipContext: "Copied Cancip context",
  downloadComplete: "Download complete: {path}",
  newTab: "New tab",
  openLink: "Open link",
  openInNewTab: "Open in new tab",
  downloadLink: "Download link",
  downloadSavedTo: "Downloads saved to: {folder}",
  tabs: "Tabs",
  page: "Page",
  view: "View",
  save: "Save",
  tools: "Tools",
  downloadPage: "Downloads ({count})",
  bookmarksCount: "Bookmarks ({count})",
  historyCount: "History ({count})",
  readingCount: "Reading ({count})",
  consoleCount: "Logs ({count})",
  downloadsCount: "Downloads ({count})",
  newObTab: "New OB tab",
  openNoteWeb: "Open Note Web",
  openInBrowser: "Open in browser",
  share: "Share",
  browserStatus: "Browser status",
  zoomIn: "Zoom in {value}%",
  zoomOut: "Zoom out",
  mobileVersion: "Mobile version",
  desktopVersion: "Desktop version",
  dayMode: "Day mode",
  closeEyeProtection: "Close eye protection",
  closeAdBlock: "Disable ad block",
  adBlocking: "Ad block",
  unmarkAds: "Unmark ads",
  closeIncognito: "Close incognito",
  exitFullscreen: "Exit fullscreen",
  fullscreen: "Fullscreen",
  enableJs: "Enable JS",
  disableJs: "Disable JS",
  closeLandscape: "Close landscape",
  landscape: "Landscape",
  fontSize: "Font size {value}%",
  downloadFile: "Download file",
  saveHtml: "Save HTML",
  saveMht: "Save MHT",
  offlinePage: "Offline page",
  desktopShortcut: "Desktop shortcut",
  removeBookmark: "Remove bookmark",
  addBookmark: "Add bookmark",
  addReadingList: "Add to reading list",
  autofillPage: "Autofill page",
  scriptsCount: "Scripts ({count})",
  mediaSniff: "Media sniff",
  pageAssets: "Page assets",
  copySource: "Copy source",
  viewSource: "View source",
  translateAction: "Translate",
  readAloud: "Read aloud",
  qrCode: "QR code",
  report: "Report",
  copyLogs: "Copy logs",
  clearCache: "Clear cache ({count})",
  siteSettings: "Site settings",
  toolStatus: "Tool status",
  clearBrowsingDataAction: "Clear browsing data",
  runningAction: "Running: {label}",
  completedAction: "Completed: {label}",
  failedAction: "{label} failed: {message}",
  downloadFinished: "Download finished: {path}",
  saved: "Saved: {path}",
  addedReadingList: "Added to reading list",
  mediaCopied: "Media copied: {count}",
  resourcesCopied: "Resources copied",
  sourceCopied: "Source copied",
  consoleCopied: "Console copied",
  cacheCleared: "Cache cleared",
  browsingDataCleared: "Browsing data cleared",
  translatePageTo: "Translate page to...",
  newObsidianTab: "New Obsidian tab",
  address: "Address",
  webResultsTab: "Web",
  imageResultsTab: "Images",
  videoResultsTab: "Videos",
  academicTab: "Academic",
  dictionaryTab: "Dictionary",
  mapsTab: "Maps",
  moreTab: "More",
  aboutResults: "About {count} results",
  learnMoreAbout: "Learn more about {query}",
  webNotePlaceholder: "Web note",
  fallbackEditableNote: "Page loading is limited; an editable note layer is kept.",
  loadingValue: "Loading: {value}",
  yes: "Yes",
  no: "No",
  downloadDirectory: "Download directory: {folder}",
  copiedLink: "Copied link",
  cancipAi: "Cancip AI",
  currentOpen: "Open current",
  readerExtracting: "Extracting page summary...",
  insertedLink: "Inserted link",
  copiedMarkdownLink: "Copied Markdown link",
  noteDrawDisabled: "NoteDraw plugin is not enabled.",
  readerNoteNotReady: "Reader note is not ready yet",
  noWebNoteToExport: "No web note to export",
  jsonCopied: "Mobile Webviewer JSON copied",
  clipboardEmpty: "Clipboard is empty",
  fileMissingPathCopied: "File not found in vault; path copied",
  htmlSaveFailed: "HTML save failed",
  mhtSaveFailed: "MHT save failed",
  shareTextCopied: "Share text copied",
  downloadFailed: "Download failed",
  cancipDisabled: "Cancip plugin is not enabled",
  noWebLinkFound: "No web link found",
  bookmarkNoteCreated: "Bookmark note created",
  emptyConsoleDesc: "No logs yet. Search, downloads, saves, and scripts will appear here.",
  pageSource: "Page source",
  copyReport: "Copy report",
  reportUrl: "Report URL",
  reportCopied: "Report copied",
  urlCopied: "URL copied",
  translatePage: "Translate page",
  noSavedPages: "No saved pages",
  noResourcesFound: "No resources found",
  disabled: "Disabled",
  noMatchingScripts: "No matching scripts",
  findInPage: "Find in page",
  previous: "Previous",
  next: "Next",
  close: "Close",
  pageLoadLimited: "Page loading is limited; an editable note layer is kept.",
  systemBrowser: "Open in system browser",
  proxyModeActive: "Site refuses embedding — real page loaded via built-in proxy",
  postFormUnsupported: "POST form submissions are not supported in proxy mode",
  clearCookies: "Clear site cookies",
  cookiesCleared: "Site cookies cleared"
};

const UI_TEXT_ZH_HANS: UiDictionary = {
  uiLanguage: "界面语言",
  uiLanguageDesc: "默认跟随 Obsidian/系统语言，也可以给插件固定一种语言。",
  followObsidian: "跟随 Obsidian 语言",
  coreEntry: "核心入口",
  coreEntryDesc: "首页、搜索、两个浏览器入口和启动行为。",
  homePage: "首页",
  homePageDesc: "主页按钮默认打开的页面。",
  searchUrl: "搜索 URL",
  searchUrlDesc: "用 {{query}} 作为已编码搜索词占位符。",
  noteBrowserCurrentUrl: "Note Browser 当前网址",
  noteBrowserCurrentUrlDesc: "打开笔记浏览器时恢复的网址。",
  openBrowser: "打开浏览器",
  openBrowserDesc: "从设置里快速打开笔记浏览器。",
  openOnStartup: "启动时打开",
  openOnStartupDesc: "Obsidian 布局就绪后用阅读视图打开笔记浏览器。",
  interfaceRendering: "界面和渲染",
  interfaceRenderingDesc: "控制手机工具栏、NoteDraw 魔法棒、阅读层和页面比例。",
  compactMobileToolbar: "紧凑手机工具栏",
  compactMobileToolbarDesc: "手机屏幕使用更小的控件。",
  showNoteDrawMagicWand: "显示 NoteDraw 魔法棒",
  showNoteDrawMagicWandDesc: "NoteDraw 可用时在 Mobile Webviewer 界面显示魔法棒。",
  readerHint: "阅读层提示",
  readerHintDesc: "内部浏览器渲染笔记化页面时显示阅读层提示。",
  liveBrowserFirst: "真实浏览器优先",
  liveBrowserFirstDesc: "把实时 WebView 放在笔记化阅读层上方。",
  frontendMode: "前端模式",
  frontendModeDesc: "默认前景：可编辑笔记或完整网页。",
  editableNote: "可编辑笔记",
  fullWebPage: "完整网页",
  autoSaveWebNotes: "自动保存网页笔记",
  autoSaveWebNotesDesc: "自动把阅读层文字和涂鸦保存到插件数据；用 存 MD 再加入 Vault。",
  webNoteFolder: "网页笔记文件夹",
  webNoteFolderDesc: "手动存 MD 导出会保存到 Vault 内这个文件夹。",
  pageZoom: "页面缩放",
  pageZoomDesc: "真实浏览器界面的默认缩放。",
  readerFontSize: "阅读字体大小",
  readerFontSizeDesc: "阅读/缓存层字体大小。",
  desktopView: "桌面视图",
  desktopViewDesc: "使用更宽的真实浏览器界面。",
  userAgent: "User Agent",
  userAgentDesc: "用于内部获取、搜索、下载请求，以及 Obsidian 允许控制的真实浏览器界面。",
  mobile: "手机",
  desktop: "桌面",
  download: "下载",
  downloadDesc: "保存文件、HTML、MHT 和离线页面。",
  downloadFolder: "下载文件夹",
  downloadFolderDesc: "更多 > 下载、HTML、MHT 保存到这里。",
  downloadConnections: "下载连接数",
  downloadConnectionsDesc: "服务器支持断点续传时使用的并行分段连接数。",
  browserMode: "浏览模式",
  browserModeDesc: "这些开关会影响 Browser View 和 Note Browser 的内部渲染。",
  nightMode: "夜间模式",
  nightModeDesc: "加深内部浏览器外壳和阅读层。",
  eyeProtection: "护眼模式",
  eyeProtectionDesc: "应用更柔和的阅读底色。",
  adBlock: "广告拦截",
  adBlockDesc: "在可访问页面中移除常见广告容器。",
  markAds: "标记广告",
  markAdsDesc: "在可访问页面中标记疑似广告容器。",
  incognito: "无痕",
  incognitoDesc: "停止写入历史和阅读缓存。",
  disableJavaScript: "禁用 JavaScript",
  disableJavaScriptDesc: "用无 allow-scripts 沙盒重新加载实时页面。",
  rotateScreen: "横屏",
  rotateScreenDesc: "使用更宽的横屏式浏览器界面。",
  dataImportExport: "数据导入导出",
  dataImportExportDesc: "收藏、稍后读、历史、下载记录、脚本规则、网页笔记和常用设置。",
  universalExport: "通用导出",
  universalExportDesc: "把可迁移的 Mobile Webviewer JSON 包保存到下载文件夹。",
  exportJson: "导出 JSON",
  copyJson: "复制 JSON",
  universalImport: "通用导入",
  universalImportDesc: "从剪贴板导入 Mobile Webviewer JSON、通用书签 HTML 或纯 URL 列表；会合并现有数据。",
  importClipboard: "导入剪贴板",
  translation: "翻译",
  translationDesc: "默认跟随 Obsidian 语言，也可以指定固定目标语言。",
  defaultTranslationLanguage: "默认翻译语言",
  defaultTranslationLanguageDesc: "用于 更多 > 翻译 和语言选择器。跟随 Obsidian 会让翻译目标跟着 Obsidian 界面语言走。",
  scriptsReader: "脚本和阅读层",
  scriptsReaderDesc: "Reader 层 CSS、JavaScript 和按网址匹配的脚本规则。",
  readerUserScripts: "阅读层用户脚本",
  readerUserScriptsDesc: "把自定义 CSS 和 JavaScript 应用到内部阅读层。",
  readerCss: "阅读层 CSS",
  readerCssDesc: "注入到渲染的阅读/缓存页面。",
  readerJavascript: "阅读层 JavaScript",
  readerJavascriptDesc: "运行时可用 container、page、hostName。",
  userScriptRules: "用户脚本规则",
  rulesCount: "规则（{count}）",
  rulesDesc: "按 URL 匹配的阅读层 CSS 和 JavaScript。",
  addRule: "添加规则",
  ruleName: "规则名称",
  delete: "删除",
  match: "匹配",
  matchDesc: "支持子串或通配符，例如 *://*.example.com/*",
  css: "CSS",
  cssDesc: "注入到匹配的阅读页面。",
  javascript: "JavaScript",
  javascriptDesc: "运行时可用 container、page、hostName、rule。",
  autofill: "自动填充",
  autofillDesc: "用于 更多 > 自动填表，只填可访问页面里的空字段。",
  autofillName: "自动填充姓名",
  autofillEmail: "自动填充邮箱",
  autofillPhone: "自动填充电话",
  autofillAddress: "自动填充地址",
  autofillFieldDesc: "用于 更多 > 自动填表。",
  dataMaintenance: "数据维护",
  dataMaintenanceDesc: "清理浏览记录、阅读缓存、下载记录和控制台日志。",
  clearHistory: "清理历史",
  clearReaderCache: "清理阅读缓存",
  clearDownloads: "清理下载记录",
  readingList: "稍后读",
  clearConsole: "清理控制台",
  clearBrowsingData: "清理浏览数据",
  clearBrowsingDataDesc: "清理历史、阅读缓存和控制台；收藏、稍后读和文件保留。",
  exportBookmarkNote: "导出收藏笔记",
  exportBookmarkNoteDesc: "创建包含当前收藏的 Markdown 笔记。",
  clear: "清理",
  create: "创建",
  savedEntries: "{count} 条保存记录。",
  cachedPages: "{count} 个缓存页面。",
  downloadRecords: "{count} 条下载记录。文件不会删除。",
  savedPages: "{count} 个保存页面。",
  consoleEntries: "{count} 条控制台记录。",
  supportCodes: "支持双码",
  supportCodesDesc: "如果这个插件帮到你，可以扫码支持继续维护。",
  searchOrEnterUrl: "搜索或输入网址",
  go: "前往",
  more: "更多",
  closeMore: "关闭更多",
  ready: "就绪",
  bookmarks: "收藏",
  history: "历史",
  reading: "稍后读",
  downloads: "下载",
  console: "日志",
  closePanel: "关闭面板",
  back: "后退",
  forward: "前进",
  reload: "刷新",
  home: "主页",
  note: "笔记",
  web: "网页",
  noteBrowser: "笔记浏览器",
  saveMd: "存 MD",
  bookmark: "收藏",
  saveLink: "保存链接",
  settings: "设置",
  noBookmarksYet: "还没有收藏",
  noReadingListYet: "还没有稍后读",
  noHistoryYet: "还没有历史",
  noDownloadsYet: "还没有下载",
  noConsoleLogs: "还没有日志",
  search: "搜索",
  searchBing: "搜索 Bing",
  searching: "搜索中...",
  searchingBing: "正在搜索 Bing...",
  resultsCount: "{count} 个结果",
  moreResults: "更多结果",
  loading: "加载中...",
  loadFailedRetry: "加载失败，重试",
  nativeLightHome: "轻量原生主页",
  reader: "阅读",
  readingStatus: "阅读中...",
  pageTools: "页面工具",
  copyLink: "复制链接",
  doodle: "涂鸦",
  closeDoodle: "关闭涂鸦",
  editableWebNote: "可编辑网页笔记",
  links: "链接",
  autoSavedPlugin: "自动保存到插件",
  saving: "保存中...",
  savedPlugin: "已自动保存到插件",
  savedMarkdown: "已入库 {path}",
  webNoteSaved: "网页笔记已保存到插件数据",
  savedTo: "已保存到 {path}",
  bookmarkAdded: "已添加收藏",
  bookmarkRemoved: "已移除收藏",
  noPreviousPage: "没有上一页",
  noNextPage: "没有下一页",
  internalBrowserTab: "内部浏览器标签",
  refresh: "刷新",
  openCancip: "打开 Cancip",
  all: "全部",
  completed: "完成",
  failed: "失败",
  today: "今天",
  latest: "最近",
  noEntries: "没有条目",
  open: "打开",
  copy: "复制",
  downloadState: "{status} · {progress}%",
  openFile: "打开",
  copyPath: "复制路径",
  location: "位置",
  source: "来源",
  cancipDetected: "已检测到 Cancip AI",
  cancipNotEnabled: "Cancip AI 未启用",
  cancipDetectedDesc: "版本 {version}，可从这里打开 AI 面板。",
  cancipNotEnabledDesc: "安装或启用 Cancip 后，Mobile Webviewer 会把网页上下文作为 AI 入口提供。",
  copyCurrentContext: "复制当前网页上下文",
  sendCurrentToCancip: "发送当前网页到 Cancip",
  sentCurrentToCancip: "当前网页已加入 Cancip",
  cancipContextPrompt: "请基于这个网页上下文继续分析、整理、摘录或生成笔记。",
  copiedCancipContext: "已复制 Cancip 上下文",
  downloadComplete: "下载完成：{path}",
  newTab: "新标签",
  openLink: "打开链接",
  openInNewTab: "新标签打开",
  downloadLink: "下载链接",
  downloadSavedTo: "下载保存到：{folder}",
  tabs: "标签",
  page: "页面",
  view: "视图",
  save: "保存",
  tools: "工具",
  downloadPage: "下载页（{count}）",
  bookmarksCount: "收藏（{count}）",
  historyCount: "历史（{count}）",
  readingCount: "稍后读（{count}）",
  consoleCount: "反馈日志（{count}）",
  downloadsCount: "下载页（{count}）",
  newObTab: "新 OB 标签",
  openNoteWeb: "打开 Note Web",
  openInBrowser: "用浏览器打开",
  share: "分享",
  browserStatus: "浏览器状态",
  zoomIn: "放大 {value}%",
  zoomOut: "缩小",
  mobileVersion: "手机版",
  desktopVersion: "桌面版",
  dayMode: "日间模式",
  closeEyeProtection: "关闭护眼",
  closeAdBlock: "关闭拦截",
  adBlocking: "广告拦截",
  unmarkAds: "取消标记广告",
  closeIncognito: "关闭无痕",
  exitFullscreen: "退出全屏",
  fullscreen: "全屏",
  enableJs: "启用 JS",
  disableJs: "禁用 JS",
  closeLandscape: "关闭横屏",
  landscape: "横屏",
  fontSize: "字号 {value}%",
  downloadFile: "下载文件",
  saveHtml: "保存 HTML",
  saveMht: "保存 MHT",
  offlinePage: "离线页面",
  desktopShortcut: "桌面快捷方式",
  removeBookmark: "移除书签",
  addBookmark: "添加书签",
  addReadingList: "加入稍后读",
  autofillPage: "自动填表",
  scriptsCount: "脚本（{count}）",
  mediaSniff: "媒体嗅探",
  pageAssets: "页面资源",
  copySource: "复制源码",
  viewSource: "查看源码",
  translateAction: "翻译",
  readAloud: "朗读",
  qrCode: "二维码",
  report: "反馈报告",
  copyLogs: "复制日志",
  clearCache: "清缓存（{count}）",
  siteSettings: "站点设置",
  toolStatus: "工具状态",
  clearBrowsingDataAction: "清浏览数据",
  runningAction: "正在执行：{label}",
  completedAction: "已完成：{label}",
  failedAction: "{label} 失败：{message}",
  downloadFinished: "下载完成：{path}",
  saved: "已保存：{path}",
  addedReadingList: "已加入稍后读",
  mediaCopied: "媒体已复制：{count}",
  resourcesCopied: "资源已复制",
  sourceCopied: "源码已复制",
  consoleCopied: "日志已复制",
  cacheCleared: "缓存已清理",
  browsingDataCleared: "浏览数据已清理",
  translatePageTo: "把页面翻译为...",
  newObsidianTab: "新 Obsidian 标签",
  address: "地址",
  webResultsTab: "网页",
  imageResultsTab: "图片",
  videoResultsTab: "视频",
  academicTab: "学术",
  dictionaryTab: "词典",
  mapsTab: "地图",
  moreTab: "更多",
  aboutResults: "约 {count} 个结果",
  learnMoreAbout: "深入了解 {query}",
  webNotePlaceholder: "网页笔记",
  fallbackEditableNote: "页面加载受限，已保留可编辑笔记层。",
  loadingValue: "加载中：{value}",
  yes: "是",
  no: "否",
  downloadDirectory: "下载目录：{folder}",
  copiedLink: "已复制链接",
  cancipAi: "Cancip AI",
  currentOpen: "当前打开",
  readerExtracting: "正在提取页面摘要...",
  insertedLink: "已插入链接",
  copiedMarkdownLink: "已复制 Markdown 链接",
  noteDrawDisabled: "NoteDraw 插件未启用。",
  readerNoteNotReady: "阅读笔记还没准备好",
  noWebNoteToExport: "没有可导出的网页笔记",
  jsonCopied: "Mobile Webviewer JSON 已复制",
  clipboardEmpty: "剪贴板为空",
  fileMissingPathCopied: "Vault 中找不到文件，已复制路径",
  htmlSaveFailed: "HTML 保存失败",
  mhtSaveFailed: "MHT 保存失败",
  shareTextCopied: "分享文本已复制",
  downloadFailed: "下载失败",
  cancipDisabled: "Cancip 插件未启用",
  noWebLinkFound: "没有找到网页链接",
  bookmarkNoteCreated: "收藏笔记已创建",
  emptyConsoleDesc: "暂无日志。执行搜索、下载、保存、脚本后会出现在这里。",
  pageSource: "页面源码",
  copyReport: "复制报告",
  reportUrl: "报告网址",
  reportCopied: "报告已复制",
  urlCopied: "网址已复制",
  translatePage: "翻译页面",
  noSavedPages: "还没有保存页面",
  noResourcesFound: "没有找到资源",
  disabled: "已禁用",
  noMatchingScripts: "没有匹配脚本",
  findInPage: "页内查找",
  previous: "上一个",
  next: "下一个",
  close: "关闭",
  pageLoadLimited: "页面加载受限，已保留可编辑笔记层。",
  systemBrowser: "用系统浏览器打开",
  proxyModeActive: "网站拒绝内嵌，已用内置代理加载真实页面",
  postFormUnsupported: "代理模式暂不支持 POST 表单提交",
  clearCookies: "清除站点 Cookie",
  cookiesCleared: "已清除站点 Cookie"
};

const UI_TEXT_ZH_HANT: UiDictionary = {
  clearCookies: "清除網站 Cookie",
  cookiesCleared: "已清除網站 Cookie",
  coreEntryDesc: "首頁、搜尋、瀏覽器入口與啟動行為。",
  homePage: "首頁",
  searchUrl: "搜尋 URL",
  openBrowser: "開啟瀏覽器",
  openOnStartup: "啟動時開啟",
  compactMobileToolbar: "精簡行動工具列",
  showNoteDrawMagicWand: "顯示 NoteDraw 魔杖",
  frontendMode: "前景模式",
  editableNote: "可編輯筆記",
  fullWebPage: "完整網頁",
  autoSaveWebNotes: "自動儲存網頁筆記",
  pageZoom: "頁面縮放",
  userAgent: "使用者代理",
  mobile: "行動版",
  desktop: "桌面版",
  downloadFolder: "下載資料夾",
  browserMode: "瀏覽器模式",
  nightMode: "夜間模式",
  eyeProtection: "護眼模式",
  adBlock: "廣告阻擋",
  markAds: "標記廣告",
  incognito: "無痕模式",
  disableJavaScript: "停用 JavaScript",
  translation: "翻譯",
  scriptsReader: "腳本與閱讀層",
  autofill: "自動填入",
  clear: "清除",
  create: "建立",
  supportCodes: "支持碼",
  go: "前往",
  ready: "就緒",
  console: "主控台",
  back: "返回",
  forward: "前進",
  reload: "重新載入",
  home: "首頁",
  note: "筆記",
  web: "網頁",
  noteBrowser: "筆記瀏覽器",
  bookmark: "書籤",
  search: "搜尋",
  searchBing: "用 Bing 搜尋",
  searching: "搜尋中...",
  reader: "閱讀器",
  copyLink: "複製連結",
  doodle: "塗鴉",
  links: "連結",
  noEntries: "無項目",
  open: "開啟",
  copy: "複製",
  source: "來源",
  openInBrowser: "在瀏覽器開啟",
  share: "分享",
  zoomOut: "縮小",
  mobileVersion: "行動版",
  desktopVersion: "桌面版",
  exitFullscreen: "離開全螢幕",
  fullscreen: "全螢幕",
  translateAction: "翻譯",
  qrCode: "QR 碼",
  close: "關閉",
  homePageDesc: "首頁按鈕開啟的預設頁面。",
  searchUrlDesc: "使用 {{query}} 作為已編碼搜尋文字的佔位符。",
  noteBrowserCurrentUrl: "筆記瀏覽器目前 URL",
  noteBrowserCurrentUrlDesc: "開啟筆記式瀏覽器時還原的 URL。",
  openBrowserDesc: "從設定快速開啟筆記式瀏覽器。",
  openOnStartupDesc: "Obsidian 版面配置就緒後，以閱讀檢視開啟筆記式瀏覽器。",
  interfaceRenderingDesc: "控制行動工具列、NoteDraw 魔杖、閱讀層與頁面縮放。",
  compactMobileToolbarDesc: "手機螢幕使用更小的控制項。",
  showNoteDrawMagicWandDesc: "當 NoteDraw 可用時，在 Mobile Webviewer 介面顯示魔杖按鈕。",
  readerHint: "閱讀器提示",
  readerHintDesc: "內建瀏覽器呈現筆記式頁面時顯示閱讀層提示。",
  liveBrowserFirst: "即時瀏覽器優先",
  liveBrowserFirstDesc: "將即時 WebView 畫面顯示在筆記式閱讀層之上。",
  frontendModeDesc: "預設前景：可編輯筆記或完整網頁。",
  webNoteFolder: "網頁筆記資料夾",
  webNoteFolderDesc: "手動「儲存 MD」的匯出會儲存在庫內此資料夾。",
  pageZoomDesc: "即時瀏覽器畫面的預設縮放。",
  readerFontSize: "閱讀器字型大小",
  readerFontSizeDesc: "閱讀/快取層的字型大小。",
  desktopView: "桌面檢視",
  desktopViewDesc: "使用更寬的即時瀏覽器畫面。",
  userAgentDesc: "供內部抓取/搜尋/下載請求使用，以及 Obsidian 有開放控制時的即時瀏覽器畫面。",
  downloadDesc: "儲存檔案、HTML、MHT 與離線頁面。",
  downloadFolderDesc: "由「更多 > 下載」、HTML 與 MHT 儲存的檔案。",
  downloadConnections: "下載連線數",
  downloadConnectionsDesc: "伺服器支援續傳時的並行位元組範圍連線。",
  browserModeDesc: "這些開關影響 Browser View 與筆記瀏覽器的內部呈現。",
  nightModeDesc: "加深內建瀏覽器外殼與閱讀介面。",
  eyeProtectionDesc: "套用更柔和的閱讀色調。",
  adBlockDesc: "在頁面可存取時移除常見廣告容器。",
  markAdsDesc: "在頁面可存取時標記疑似廣告容器。",
  incognitoDesc: "停止寫入歷史與閱讀快取。",
  disableJavaScriptDesc: "在沙盒中不帶 allow-scripts 重新載入即時頁面。",
  rotateScreen: "旋轉螢幕",
  rotateScreenDesc: "使用更寬的橫向式瀏覽器畫面。",
  dataImportExportDesc: "書籤、閱讀清單、歷史、下載、腳本規則、網頁筆記與常用設定。",
  universalExport: "通用匯出",
  universalExportDesc: "將可攜的 Mobile Webviewer JSON 套件儲存到下載資料夾。",
  exportJson: "匯出 JSON",
  copyJson: "複製 JSON",
  universalImport: "通用匯入",
  universalImportDesc: "從剪貼簿匯入 Mobile Webviewer JSON、常見書籤 HTML 或純 URL 行。現有資料會被合併。",
  importClipboard: "從剪貼簿匯入",
  translationDesc: "預設跟隨 Obsidian 語言，或選擇固定的目標語言。",
  defaultTranslationLanguage: "預設翻譯語言",
  defaultTranslationLanguageDesc: "供「更多 > 翻譯」與語言選擇器使用。「跟隨 Obsidian」會讓翻譯綁定 Obsidian 目前的介面語言。",
  scriptsReaderDesc: "閱讀層 CSS、JavaScript 與依 URL 配對的腳本規則。",
  readerUserScripts: "閱讀器使用者腳本",
  readerUserScriptsDesc: "對內建閱讀層套用自訂 CSS 與 JavaScript。",
  readerCss: "閱讀器 CSS",
  readerCssDesc: "注入到已呈現的閱讀/快取頁面的 CSS。",
  readerJavascript: "閱讀器 JavaScript",
  readerJavascriptDesc: "以 container、page、hostName 執行。",
  userScriptRules: "使用者腳本規則",
  rulesCount: "規則（{count}）",
  rulesDesc: "內建閱讀層使用的依 URL 配對 CSS 與 JavaScript。",
  addRule: "新增規則",
  ruleName: "規則名稱",
  delete: "刪除",
  match: "配對",
  matchDesc: "支援子字串或萬用字元，例如 *://*.example.com/*",
  css: "CSS",
  cssDesc: "注入到配對的閱讀頁面。",
  javascript: "JavaScript",
  javascriptDesc: "以 container、page、hostName、rule 執行。",
  autofillDesc: "供「更多 > 自動填入頁面」使用；僅填入可存取的空白欄位。",
  autofillName: "自動填入姓名",
  autofillEmail: "自動填入電子郵件",
  autofillPhone: "自動填入電話",
  autofillAddress: "自動填入地址",
  autofillFieldDesc: "供「更多 > 自動填入頁面」使用。",
  dataMaintenanceDesc: "清除瀏覽歷史、閱讀快取、下載與主控台日誌。",
  clearHistory: "清除歷史",
  clearReaderCache: "清除閱讀快取",
  clearDownloads: "清除下載",
  readingList: "閱讀清單",
  clearConsole: "清除主控台",
  clearBrowsingData: "清除瀏覽資料",
  clearBrowsingDataDesc: "清除歷史、閱讀快取與主控台記錄。書籤、閱讀清單與檔案會保留。",
  exportBookmarkNote: "匯出書籤筆記",
  exportBookmarkNoteDesc: "建立包含目前書籤的 Markdown 筆記。",
  savedEntries: "已儲存 {count} 筆項目。",
  cachedPages: "已快取 {count} 個頁面。",
  downloadRecords: "已儲存 {count} 筆下載記錄。檔案不會被移除。",
  savedPages: "已儲存 {count} 個頁面。",
  consoleEntries: "{count} 筆主控台記錄。",
  supportCodesDesc: "如果此外掛對你有幫助，掃描碼以支持持續維護。",
  closeMore: "關閉更多",
  closePanel: "關閉面板",
  saveLink: "儲存連結",
  noReadingListYet: "尚無閱讀清單",
  noConsoleLogs: "無主控台日誌",
  searchingBing: "正在 Bing 搜尋...",
  resultsCount: "{count} 筆結果",
  nativeLightHome: "原生輕量首頁",
  readingStatus: "讀取中...",
  pageTools: "頁面工具",
  closeDoodle: "關閉塗鴉",
  editableWebNote: "可編輯網頁筆記",
  autoSavedPlugin: "已自動儲存到外掛",
  savedMarkdown: "已儲存到 {path}",
  webNoteSaved: "網頁筆記已儲存於外掛資料",
  savedTo: "已儲存到 {path}",
  noPreviousPage: "沒有上一頁",
  noNextPage: "沒有下一頁",
  internalBrowserTab: "內建瀏覽器分頁",
  refresh: "重新整理",
  openCancip: "開啟 Cancip",
  all: "全部",
  completed: "已完成",
  failed: "失敗",
  today: "今天",
  latest: "最新",
  downloadState: "{status} · {progress}%",
  openFile: "開啟",
  copyPath: "複製路徑",
  location: "位置",
  cancipDetected: "偵測到 Cancip AI",
  cancipNotEnabled: "Cancip AI 未啟用",
  cancipDetectedDesc: "版本 {version}；從這裡開啟 AI 面板。",
  cancipNotEnabledDesc: "安裝或啟用 Cancip 後，Mobile Webviewer 可將目前的網頁情境提供為 AI 入口。",
  copyCurrentContext: "複製目前網頁情境",
  sendCurrentToCancip: "將目前頁面傳送到 Cancip",
  sentCurrentToCancip: "目前頁面已加入 Cancip",
  cancipContextPrompt: "使用此網頁情境進行分析、整理、摘錄或產生筆記。",
  copiedCancipContext: "已複製 Cancip 情境",
  downloadComplete: "下載完成：{path}",
  newTab: "新分頁",
  downloadLink: "下載連結",
  downloadSavedTo: "下載已儲存於：{folder}",
  downloadPage: "下載（{count}）",
  bookmarksCount: "書籤（{count}）",
  historyCount: "歷史（{count}）",
  readingCount: "閱讀（{count}）",
  consoleCount: "日誌（{count}）",
  downloadsCount: "下載（{count}）",
  newObTab: "新 OB 分頁",
  openNoteWeb: "開啟 Note Web",
  browserStatus: "瀏覽器狀態",
  zoomIn: "放大 {value}%",
  dayMode: "日間模式",
  closeEyeProtection: "關閉護眼模式",
  closeAdBlock: "關閉廣告阻擋",
  adBlocking: "廣告阻擋",
  unmarkAds: "取消廣告標記",
  closeIncognito: "關閉無痕模式",
  enableJs: "啟用 JS",
  disableJs: "停用 JS",
  closeLandscape: "關閉橫向模式",
  landscape: "橫向模式",
  fontSize: "字型大小 {value}%",
  downloadFile: "下載檔案",
  saveHtml: "儲存 HTML",
  saveMht: "儲存 MHT",
  offlinePage: "離線頁面",
  desktopShortcut: "桌面捷徑",
  addReadingList: "加入閱讀清單",
  autofillPage: "自動填入頁面",
  scriptsCount: "腳本（{count}）",
  mediaSniff: "媒體偵測",
  pageAssets: "頁面資源",
  copySource: "複製原始碼",
  viewSource: "檢視原始碼",
  readAloud: "朗讀",
  report: "報告",
  copyLogs: "複製日誌",
  clearCache: "清除快取（{count}）",
  siteSettings: "網站設定",
  toolStatus: "工具狀態",
  clearBrowsingDataAction: "清除瀏覽資料",
  runningAction: "執行中：{label}",
  completedAction: "已完成：{label}",
  failedAction: "{label} 失敗：{message}",
  downloadFinished: "下載完成：{path}",
  saved: "已儲存：{path}",
  addedReadingList: "已加入閱讀清單",
  mediaCopied: "已複製媒體：{count}",
  resourcesCopied: "已複製資源",
  sourceCopied: "已複製原始碼",
  consoleCopied: "已複製主控台",
  cacheCleared: "快取已清除",
  browsingDataCleared: "瀏覽資料已清除",
  translatePageTo: "將頁面翻譯成...",
  newObsidianTab: "新 Obsidian 分頁",
  address: "網址",
  webResultsTab: "網頁",
  imageResultsTab: "圖片",
  videoResultsTab: "影片",
  academicTab: "學術",
  dictionaryTab: "字典",
  mapsTab: "地圖",
  moreTab: "更多",
  aboutResults: "約 {count} 筆結果",
  learnMoreAbout: "進一步了解 {query}",
  webNotePlaceholder: "網頁筆記",
  fallbackEditableNote: "頁面載入受限；保留可編輯筆記層。",
  loadingValue: "載入中：{value}",
  yes: "是",
  no: "否",
  downloadDirectory: "下載目錄：{folder}",
  cancipAi: "Cancip AI",
  currentOpen: "開啟目前頁面",
  readerExtracting: "正在擷取頁面摘要...",
  insertedLink: "已插入連結",
  copiedMarkdownLink: "已複製 Markdown 連結",
  noteDrawDisabled: "NoteDraw 外掛未啟用。",
  readerNoteNotReady: "閱讀器筆記尚未就緒",
  noWebNoteToExport: "沒有可匯出的網頁筆記",
  jsonCopied: "已複製 Mobile Webviewer JSON",
  clipboardEmpty: "剪貼簿是空的",
  fileMissingPathCopied: "庫中找不到檔案；已複製路徑",
  htmlSaveFailed: "HTML 儲存失敗",
  mhtSaveFailed: "MHT 儲存失敗",
  shareTextCopied: "已複製分享文字",
  downloadFailed: "下載失敗",
  cancipDisabled: "Cancip 外掛未啟用",
  noWebLinkFound: "找不到網頁連結",
  bookmarkNoteCreated: "已建立書籤筆記",
  emptyConsoleDesc: "尚無日誌。搜尋、下載、儲存與腳本記錄會顯示在這裡。",
  pageSource: "頁面原始碼",
  copyReport: "複製報告",
  reportUrl: "報告網址",
  reportCopied: "已複製報告",
  urlCopied: "已複製網址",
  translatePage: "翻譯頁面",
  noSavedPages: "沒有已儲存頁面",
  noResourcesFound: "找不到資源",
  disabled: "已停用",
  noMatchingScripts: "沒有符合的腳本",
  findInPage: "頁內搜尋",
  previous: "上一個",
  next: "下一個",
  pageLoadLimited: "頁面載入受限；保留可編輯筆記層。",
  systemBrowser: "用系統瀏覽器開啟",
  proxyModeActive: "網站拒絕內嵌，已用內建代理載入真實頁面",
  postFormUnsupported: "代理模式暫不支援 POST 表單提交",
  ...UI_TEXT_ZH_HANS,
  followObsidian: "跟隨 Obsidian 語言",
  uiLanguage: "介面語言",
  uiLanguageDesc: "預設跟隨 Obsidian/系統語言，也可以固定插件語言。",
  coreEntry: "核心入口",
  interfaceRendering: "介面和渲染",
  autoSaveWebNotesDesc: "自動把閱讀層文字和塗鴉儲存到插件資料；用存 MD 再加入 Vault。",
  download: "下載",
  dataImportExport: "資料匯入匯出",
  dataMaintenance: "資料維護",
  bookmarks: "書籤",
  history: "歷史",
  reading: "稍後讀",
  downloads: "下載",
  settings: "設定",
  searchOrEnterUrl: "搜尋或輸入網址",
  more: "更多",
  saveMd: "存 MD",
  noBookmarksYet: "尚無書籤",
  noHistoryYet: "尚無歷史",
  noDownloadsYet: "尚無下載",
  moreResults: "更多結果",
  loading: "載入中...",
  loadFailedRetry: "載入失敗，重試",
  saving: "儲存中...",
  savedPlugin: "已自動儲存到插件",
  bookmarkAdded: "已加入書籤",
  bookmarkRemoved: "已移除書籤",
  openLink: "開啟連結",
  openInNewTab: "新標籤開啟",
  tabs: "標籤",
  page: "頁面",
  view: "檢視",
  save: "儲存",
  tools: "工具",
  addBookmark: "加入書籤",
  removeBookmark: "移除書籤",
  copiedLink: "已複製連結"
};

const UI_TEXT_UG: UiDictionary = {
  clearCookies: "تور بەت Cookie لىرىنى تازىلاش",
  cookiesCleared: "تور بەت Cookie لىرى تازىلاندى",
  noBookmarksYet: "تېخى خەتكۈش يوق",
  noHistoryYet: "تېخى تارىخ يوق",
  noDownloadsYet: "تېخى چۈشۈرمە يوق",
  noEntries: "تۈر يوق",
  mobileVersion: "يانفون نەشرى",
  desktopVersion: "ئۈستەل نەشرى",
  exitFullscreen: "تولۇق ئېكراندىن چىقىش",
  fullscreen: "تولۇق ئېكران",
  close: "ياپىش",
  homePageDesc: "باش بەت كۇنۇپكىسى ئاچىدىغان سۈكۈتتىكى بەت.",
  searchUrlDesc: "{{query}} نى كودلانغان ئىزدەش تېكىستى ئورنىغا ئىشلىتىڭ.",
  noteBrowserCurrentUrl: "خاتىرە كۆرگۈچنىڭ ھازىرقى ئادرېسى",
  noteBrowserCurrentUrlDesc: "خاتىرە شەكلىدىكى كۆرگۈچ ئېچىلغاندا ئەسلىگە كەلتۈرۈلىدىغان ئادرېس.",
  openBrowserDesc: "تەڭشەكلەردىن خاتىرە كۆرگۈچنى تېز ئېچىش.",
  openOnStartupDesc: "Obsidian ئورۇنلاشتۇرۇلۇشى تەييار بولغاندىن كېيىن خاتىرە كۆرگۈچنى ئوقۇش كۆرۈنۈشىدە ئېچىش.",
  interfaceRenderingDesc: "يانفون قورال بالداق، NoteDraw سېھىر تاياقچىسى، ئوقۇغۇچ قاتلىمى ۋە بەت كېڭەيتىشنى كونترول قىلىش.",
  compactMobileToolbarDesc: "تېلېفون ئېكرانلىرى ئۈچۈن تېخىمۇ كىچىك كونتروللارنى ئىشلىتىش.",
  showNoteDrawMagicWandDesc: "NoteDraw بار بولغاندا Mobile Webviewer يۈزلىرىدە تاياقچە كۇنۇپكىسىنى كۆرسىتىش.",
  readerHint: "ئوقۇغۇچ ئەسكەرتىشى",
  readerHintDesc: "ئىچكى كۆرگۈچ خاتىرىگە ئوخشاش بەتلەرنى كۆرسەتكەندە ئوقۇغۇچ قاتلىمى ئەسكەرتىشلىرىنى كۆرسىتىش.",
  liveBrowserFirst: "جانلىق كۆرگۈچ ئالدىدا",
  liveBrowserFirstDesc: "خاتىرە ئۇسلۇبىدىكى ئوقۇغۇچ قاتلىمىنىڭ ئۈستىدە جانلىق WebView يۈزىنى كۆرسىتىش.",
  frontendModeDesc: "سۈكۈتتىكى ئالدى ئۇچ: تەھرىرلىگىلى بولىدىغان خاتىرە ياكى تولۇق تور بەت.",
  autoSaveWebNotesDesc: "تەھرىرلەنگەن ئوقۇغۇچ تېكىستى ۋە سىزما خاتىرىلەرنى پەقەت قىستۇرما سانلىق مەلۇماتىغا ئاڭلىق ساقلاش. Vault غا Markdown ھۆججەت قوشۇش ئۈچۈن Save MD نى ئىشلىتىڭ.",
  webNoteFolder: "تور خاتىرە قىسقۇچى",
  webNoteFolderDesc: "قولدا Save MD قىلىنغان چىقىرىشلار مۇشۇ قىسقۇچقا ساقلىنىدۇ.",
  pageZoomDesc: "جانلىق كۆرگۈچ يۈزلىرىنىڭ سۈكۈتتىكى كېڭەيتىلىشى.",
  readerFontSize: "ئوقۇغۇچ خەت چوڭلۇقى",
  readerFontSizeDesc: "ئوقۇغۇچ/غەملەك قاتلىمىنىڭ خەت چوڭلۇقى.",
  desktopView: "ئۈستەل كۆرۈنۈشى",
  desktopViewDesc: "تېخىمۇ كەڭ جانلىق كۆرگۈچ يۈزىنى ئىشلىتىش.",
  userAgentDesc: "ئىچكى ئېلىش/ئىزدەش/چۈشۈرۈش تەلەپلىرى ۋە Obsidian كونترول قىلالايدىغان جانلىق كۆرگۈچ يۈزىدە ئىشلىتىلىدۇ.",
  downloadDesc: "ھۆججەت، HTML، MHT ۋە تورسىز بەتلەرنى ساقلاش.",
  downloadFolderDesc: "More > Download، HTML ۋە MHT ساقلىغان ھۆججەتلەر.",
  downloadConnections: "چۈشۈرۈش ئۇلانمىلىرى",
  downloadConnectionsDesc: "مۇلازىمېتېر داۋاملاشتۇرغىلى بولىدىغان چۈشۈرۈشنى قوللىغاندا پاراللېل بايت دائىرە ئۇلانمىلىرى.",
  browserModeDesc: "بۇ ۋىكليۇچاتېللار Browser View ۋە Note Browser نىڭ ئىچكى كۆرسىتىشىگە تەسىر كۆرسىتىدۇ.",
  nightModeDesc: "ئىچكى كۆرگۈچ پالىقى ۋە ئوقۇغۇچ يۈزلىرىنى قاراڭغۇلاشتۇرىدۇ.",
  eyeProtectionDesc: "تېخىمۇ يۇمشاق ئوقۇش رەڭگى ئىشلىتىدۇ.",
  adBlockDesc: "بەتكە كىرەلىگەن يەردە كۆپ ئۇچرايدىغان ئېلان قاچىلىرىنى چىقىرىۋېتىدۇ.",
  markAdsDesc: "بەتكە كىرەلىگەن يەردە ئېھتىماللىقى يۇقىرى ئېلان قاچىلىرىنى بەلگىلەيدۇ.",
  incognitoDesc: "تارىخ ۋە ئوقۇغۇچ غەملەك يېزىشلىرىنى توختىتىدۇ.",
  disableJavaScriptDesc: "جانلىق بەتلەرنى قايتا يۈكلەپ، قۇمنىڭ allow-scripts ھوقۇقىنى ئېلىپ تاشلايدۇ.",
  rotateScreen: "ئېكراننى ئايلاندۇرۇش",
  rotateScreenDesc: "تېخىمۇ كەڭ توغرىسىغا كۆرگۈچ يۈزىنى ئىشلىتىدۇ.",
  dataImportExportDesc: "خەتكۈشلەر، ئوقۇش تىزىملىكى، تارىخ، چۈشۈرمىلەر، قوليازما قائىدىلىرى، تور خاتىرىلىرى ۋە كۆپ ئۇچرايدىغان تەڭشەكلەر.",
  universalExport: "ئومۇمىي چىقىرىش",
  universalExportDesc: "يۆتكىلىشچان Mobile Webviewer JSON بوغچىسىنى چۈشۈرۈش قىسقۇچىغا ساقلاش.",
  exportJson: "JSON چىقىرىش",
  copyJson: "JSON كۆچۈرۈش",
  universalImport: "ئومۇمىي ئەكىرىش",
  universalImportDesc: "چاپلاش تاختىسىدىن Mobile Webviewer JSON، كۆپ ئۇچرايدىغان خەتكۈش HTML ياكى ئاددىي ئادرېس قۇرلىرىنى ئەكىرىش. بار سانلىق مەلۇماتلار بىرلەشتۈرۈلىدۇ.",
  importClipboard: "چاپلاش تاختىسىدىن ئەكىرىش",
  translationDesc: "سۈكۈتتە Obsidian تىلىغا ئەگىشىدۇ، ياكى مۇقىم نىشان تىل تاللاڭ.",
  defaultTranslationLanguage: "سۈكۈتتىكى تەرجىمە تىلى",
  defaultTranslationLanguageDesc: "More > Translate ۋە تىل تاللىغۇچتا ئىشلىتىلىدۇ. Obsidian تىلىغا ئەگىشىش تەرجىمىنى Obsidian نىڭ ھازىرقى كۆرۈنمە يۈز تىلىغا باغلايدۇ.",
  scriptsReaderDesc: "ئوقۇغۇچ قاتلىمى CSS، JavaScript ۋە ئادرېس ماس كېلىدىغان قوليازما قائىدىلىرى.",
  readerUserScripts: "ئوقۇغۇچ ئىشلەتكۈچى قوليازمىلىرى",
  readerUserScriptsDesc: "ئىچكى ئوقۇغۇچ قاتلىمىغا خاس CSS ۋە JavaScript ئىشلىتىش.",
  readerCss: "ئوقۇغۇچ CSS",
  readerCssDesc: "كۆرسىتىلگەن ئوقۇغۇچ/غەملەك بەتلەرگە كىرگۈزۈلىدىغان CSS.",
  readerJavascript: "ئوقۇغۇچ JavaScript",
  readerJavascriptDesc: "container، page ۋە hostName بىلەن ئىجرا بولىدۇ.",
  userScriptRules: "ئىشلەتكۈچى قوليازما قائىدىلىرى",
  rulesCount: "قائىدىلەر ({count})",
  rulesDesc: "ئىچكى ئوقۇغۇچ قاتلىمى ئۈچۈن ئادرېس ماس كېلىدىغان CSS ۋە JavaScript.",
  addRule: "قائىدە قوشۇش",
  ruleName: "قائىدە ئىسمى",
  delete: "ئۆچۈرۈش",
  match: "ماسلىشىش",
  matchDesc: "پارچە ياكى باش ئۇنى مەنىسىدە ماسلاشتۇرۇشنى قوللايدۇ، مەسىلەن *://*.example.com/*",
  css: "CSS",
  cssDesc: "ماس كەلگەن ئوقۇغۇچ بەتلەرگە كىرگۈزۈلىدۇ.",
  javascript: "JavaScript",
  javascriptDesc: "container، page، hostName ۋە rule بىلەن ئىجرا بولىدۇ.",
  autofillDesc: "More > Autofill page دە ئىشلىتىلىدۇ؛ پەقەت كىرەلىگەن قۇرۇق بۆلەكلەرنى تولدۇرىدۇ.",
  autofillName: "ئاڭلىق تولدۇرۇش ئىسمى",
  autofillEmail: "ئاڭلىق تولدۇرۇش ئېلخەت",
  autofillPhone: "ئاڭلىق تولدۇرۇش تېلېفون",
  autofillAddress: "ئاڭلىق تولدۇرۇش ئادرېسى",
  autofillFieldDesc: "More > Autofill page دە ئىشلىتىلىدۇ.",
  dataMaintenanceDesc: "كۆرۈش تارىخى، ئوقۇغۇچ غەملىكى، چۈشۈرمىلەر ۋە كونترول سۇپىسى خاتىرىلىرىنى تازىلاش.",
  clearHistory: "تارىخنى تازىلاش",
  clearReaderCache: "ئوقۇغۇچ غەملىكىنى تازىلاش",
  clearDownloads: "چۈشۈرمىلەرنى تازىلاش",
  readingList: "ئوقۇش تىزىملىكى",
  clearConsole: "كونترول سۇپىسىنى تازىلاش",
  clearBrowsingData: "كۆرۈش سانلىق مەلۇماتىنى تازىلاش",
  clearBrowsingDataDesc: "تارىخ، ئوقۇغۇچ غەملىكى ۋە كونترول سۇپىسى خاتىرىلىرىنى تازىلايدۇ. خەتكۈشلەر، ئوقۇش تىزىملىكى ۋە ھۆججەتلەر ساقلىنىدۇ.",
  exportBookmarkNote: "خەتكۈش خاتىرىسى چىقىرىش",
  exportBookmarkNoteDesc: "ھازىرقى خەتكۈشلەرنى ئۆز ئىچىگە ئالغان Markdown خاتىرىسى قۇرۇش.",
  savedEntries: "{count} تۈر ساقلاندى.",
  cachedPages: "{count} بەت غەملەندى.",
  downloadRecords: "{count} چۈشۈرۈش خاتىرىسى ساقلاندى. ھۆججەتلەر ئۆچۈرۈلمەيدۇ.",
  savedPages: "{count} بەت ساقلاندى.",
  consoleEntries: "{count} كونترول سۇپىسى خاتىرىسى.",
  supportCodesDesc: "بۇ قىستۇرما يارىغان بولسا، داۋاملىق ئاسراشنى قوللاش ئۈچۈن كودنى سكاننېرلاڭ.",
  closeMore: "More نى ياپىش",
  closePanel: "تاختاينى ياپىش",
  saveLink: "ئۇلانمىنى ساقلاش",
  noReadingListYet: "تېخى ئوقۇش تىزىملىكى يوق",
  noConsoleLogs: "كونترول سۇپىسى خاتىرىسى يوق",
  searchingBing: "Bing دا ئىزدەۋاتىدۇ...",
  resultsCount: "{count} نەتىجە",
  loadFailedRetry: "يۈكلىنىش مەغلۇپ بولدى، قايتا سىناڭ",
  nativeLightHome: "يەرلىك يېنىك باش بەت",
  readingStatus: "ئوقۇۋاتىدۇ...",
  pageTools: "بەت قوراللىرى",
  closeDoodle: "سىزمانى ياپىش",
  editableWebNote: "تەھرىرلەشكە بولىدىغان تور خاتىرىسى",
  autoSavedPlugin: "قىستۇرمىغا ئاڭلىق ساقلاندى",
  savedMarkdown: "{path} غا ساقلاندى",
  webNoteSaved: "تور خاتىرىسى قىستۇرما سانلىق مەلۇماتىغا ساقلاندى",
  savedTo: "{path} غا ساقلاندى",
  bookmarkAdded: "خەتكۈش قوشۇلدى",
  bookmarkRemoved: "خەتكۈش ئۆچۈرۈلدى",
  noPreviousPage: "ئالدىنقى بەت يوق",
  noNextPage: "كېيىنكى بەت يوق",
  internalBrowserTab: "ئىچكى كۆرگۈچ بەتكۈچى",
  refresh: "يېڭىلاش",
  openCancip: "Cancip نى ئېچىش",
  all: "ھەممىسى",
  completed: "تاماملاندى",
  failed: "مەغلۇپ بولدى",
  today: "بۈگۈن",
  latest: "ئەڭ يېڭى",
  downloadState: "{status} · {progress}%",
  openFile: "ئېچىش",
  copyPath: "يولنى كۆچۈرۈش",
  location: "ئورۇن",
  cancipDetected: "Cancip AI تەكشۈرۈلدى",
  cancipNotEnabled: "Cancip AI قوزغىتىلمىغان",
  cancipDetectedDesc: "نەشرى {version}؛ AI تاختايىسىنى مۇشۇ يەردىن ئېچىڭ.",
  cancipNotEnabledDesc: "Cancip نى ئورنىتىش ياكى قوزغاتقاندىن كېيىن، Mobile Webviewer ھازىرقى تور مەزمۇنىنى AI كىرىشى سۈپىتىدە تەمىنلىيەلەيدۇ.",
  copyCurrentContext: "ھازىرقى تور مەزمۇنىنى كۆچۈرۈش",
  sendCurrentToCancip: "ھازىرقى بەتنى Cancip غا ئەۋەتىش",
  sentCurrentToCancip: "ھازىرقى بەت Cancip غا قوشۇلدى",
  cancipContextPrompt: "بۇ تور مەزمۇنىنى تەھلىل قىلىش، تەرتىپلەش، ئۈزۈندە ئېلىش ياكى خاتىرە ھاسىللاشقا ئىشلىتىڭ.",
  copiedCancipContext: "Cancip مەزمۇنى كۆچۈرۈلدى",
  downloadComplete: "چۈشۈرۈش تاماملاندى: {path}",
  newTab: "يېڭى بەتكۈچ",
  openLink: "ئۇلانمىنى ئېچىش",
  openInNewTab: "يېڭى بەتكۈچتە ئېچىش",
  downloadLink: "ئۇلانمىنى چۈشۈرۈش",
  downloadSavedTo: "چۈشۈرمىلەر ساقلانغان ئورۇن: {folder}",
  downloadPage: "چۈشۈرمىلەر ({count})",
  bookmarksCount: "خەتكۈشلەر ({count})",
  historyCount: "تارىخ ({count})",
  readingCount: "ئوقۇش ({count})",
  consoleCount: "خاتىرىلەر ({count})",
  downloadsCount: "چۈشۈرمىلەر ({count})",
  newObTab: "يېڭى OB بەتكۈچى",
  openNoteWeb: "Note Web نى ئېچىش",
  browserStatus: "كۆرگۈچ ھالىتى",
  zoomIn: "چوڭايتىش {value}%",
  dayMode: "كۈندۈز ئۇسلۇبى",
  closeEyeProtection: "كۆز ئاسراشنى ئېتىش",
  closeAdBlock: "ئېلان توسۇشنى ئېتىش",
  adBlocking: "ئېلان توسۇش",
  unmarkAds: "ئېلان بەلگىسىنى ئېلىش",
  closeIncognito: "نومۇسسىز ھالەتنى ئېتىش",
  enableJs: "JS نى قوزغىتىش",
  disableJs: "JS نى چەكلەش",
  closeLandscape: "توغرىسىغا كۆرۈنۈشنى ئېتىش",
  landscape: "توغرىسىغا كۆرۈنۈش",
  fontSize: "خەت چوڭلۇقى {value}%",
  downloadFile: "ھۆججەت چۈشۈرۈش",
  saveHtml: "HTML ساقلاش",
  saveMht: "MHT ساقلاش",
  offlinePage: "تورسىز بەت",
  desktopShortcut: "ئۈستەل قىسقا يولى",
  addReadingList: "ئوقۇش تىزىملىكىگە قوشۇش",
  autofillPage: "بەتنى ئاڭلىق تولدۇرۇش",
  scriptsCount: "قوليازمىلار ({count})",
  mediaSniff: "مېدىيا تەكشۈرۈش",
  pageAssets: "بەت بايلىقلىرى",
  copySource: "مەنبەنى كۆچۈرۈش",
  viewSource: "مەنبەنى كۆرۈش",
  readAloud: "ئاۋازلىق ئوقۇش",
  report: "دوكلات",
  copyLogs: "خاتىرىلەرنى كۆچۈرۈش",
  clearCache: "غەملەكنى تازىلاش ({count})",
  siteSettings: "بەت تەڭشەكلىرى",
  toolStatus: "قورال ھالىتى",
  clearBrowsingDataAction: "كۆرۈش سانلىق مەلۇماتىنى تازىلاش",
  runningAction: "ئىجرا بولۇۋاتىدۇ: {label}",
  completedAction: "تاماملاندى: {label}",
  failedAction: "{label} مەغلۇپ بولدى: {message}",
  downloadFinished: "چۈشۈرۈش تاماملاندى: {path}",
  saved: "ساقلاندى: {path}",
  addedReadingList: "ئوقۇش تىزىملىكىگە قوشۇلدى",
  mediaCopied: "مېدىيا كۆچۈرۈلدى: {count}",
  resourcesCopied: "بايلىقلار كۆچۈرۈلدى",
  sourceCopied: "مەنبە كۆچۈرۈلدى",
  consoleCopied: "كونترول سۇپىسى كۆچۈرۈلدى",
  cacheCleared: "غەملەك تازىلاندى",
  browsingDataCleared: "كۆرۈش سانلىق مەلۇماتى تازىلاندى",
  translatePageTo: "بەتنى تەرجىمە قىلىش…",
  newObsidianTab: "يېڭى Obsidian بەتكۈچى",
  address: "ئادرېس",
  webResultsTab: "تور",
  imageResultsTab: "رەسىملەر",
  videoResultsTab: "سىنلار",
  academicTab: "ئىلىمىي",
  dictionaryTab: "لۇغەت",
  mapsTab: "خەرىتىلەر",
  moreTab: "تېخىمۇ كۆپ",
  aboutResults: "تەخمىنەن {count} نەتىجە",
  learnMoreAbout: "{query} ھەققىدە تېخىمۇ كۆپ",
  webNotePlaceholder: "تور خاتىرىسى",
  fallbackEditableNote: "بەت يۈكلىنىشى چەكلىك؛ تەھرىرلەشكە بولىدىغان خاتىرە قاتلىمى ساقلاندى.",
  loadingValue: "يۈكلىنىۋاتىدۇ: {value}",
  yes: "ھەئە",
  no: "ياق",
  downloadDirectory: "چۈشۈرۈش مۇندەرىجىسى: {folder}",
  cancipAi: "Cancip AI",
  currentOpen: "ھازىرقىنى ئېچىش",
  readerExtracting: "بەت خۇلاسىسى چىقىرىلىۋاتىدۇ...",
  insertedLink: "ئۇلانما قىستۇرۇلدى",
  copiedMarkdownLink: "Markdown ئۇلانمىسى كۆچۈرۈلدى",
  noteDrawDisabled: "NoteDraw قىستۇرمىسى قوزغىتىلمىغان.",
  readerNoteNotReady: "ئوقۇغۇچ خاتىرىسى تېخى تەييار ئەمەس",
  noWebNoteToExport: "چىقىرىشقا تور خاتىرىسى يوق",
  jsonCopied: "Mobile Webviewer JSON كۆچۈرۈلدى",
  clipboardEmpty: "چاپلاش تاختايسى قۇرۇق",
  fileMissingPathCopied: "ھۆججەت vault تا تېپىلمىدى؛ يول كۆچۈرۈلدى",
  htmlSaveFailed: "HTML ساقلاش مەغلۇپ بولدى",
  mhtSaveFailed: "MHT ساقلاش مەغلۇپ بولدى",
  shareTextCopied: "ھەمبەھىر تېكىستى كۆچۈرۈلدى",
  downloadFailed: "چۈشۈرۈش مەغلۇپ بولدى",
  cancipDisabled: "Cancip قىستۇرمىسى قوزغىتىلمىغان",
  noWebLinkFound: "تور ئۇلانمىسى تېپىلمىدى",
  bookmarkNoteCreated: "خەتكۈش خاتىرىسى قۇرۇلدى",
  emptyConsoleDesc: "تېخى خاتىرە يوق. ئىزدەش، چۈشۈرۈش، ساقلاش ۋە قوليازما خاتىرىلىرى مۇشۇ يەردە كۆرۈنىدۇ.",
  pageSource: "بەت مەنبەسى",
  copyReport: "دوكلاتنى كۆچۈرۈش",
  reportUrl: "دوكلات ئادرېسى",
  reportCopied: "دوكلات كۆچۈرۈلدى",
  urlCopied: "ئادرېس كۆچۈرۈلدى",
  translatePage: "بەتنى تەرجىمە قىلىش",
  noSavedPages: "ساقلانغان بەت يوق",
  noResourcesFound: "بايلىق تېپىلمىدى",
  disabled: "چەكلەنگەن",
  noMatchingScripts: "ماس كېلىدىغان قوليازما يوق",
  findInPage: "بەت ئىچىدىن ئىزدەش",
  previous: "ئالدىنقى",
  next: "كېيىنكى",
  pageLoadLimited: "بەت يۈكلىنىشى چەكلىك؛ تەھرىرلەشكە بولىدىغان خاتىرە قاتلىمى ساقلاندى.",
  systemBrowser: "سىستېما كۆرگۈچىدە ئېچىش",
  proxyModeActive: "بەت كىرگۈزۈشنى رەت قىلدى — ئىچكى ۋاكالەتچى بىلەن ھەقىقىي بەت يۈكلەندى",
  postFormUnsupported: "ۋاكالەتچى ئۇسلۇبىدا POST جەدۋەل يوللاش قوللىمايدۇ",
  uiLanguage: "كۆرۈنمە يۈزى تىلى",
  uiLanguageDesc: "سۈكۈتتە Obsidian ياكى سىستېما تىلىغا ئەگىشىدۇ؛ خالىسىڭىز مۇقىم تىل تاللاڭ.",
  followObsidian: "Obsidian تىلىغا ئەگىشىش",
  coreEntry: "ئاساسىي كىرىش",
  coreEntryDesc: "باش بەت، ئىزدەش، كۆرگۈچ كىرىشى ۋە قوزغىلىش ھەرىكىتى.",
  homePage: "باش بەت",
  searchUrl: "ئىزدەش URL",
  openBrowser: "كۆرگۈچنى ئېچىش",
  openOnStartup: "قوزغالغاندا ئېچىش",
  interfaceRendering: "كۆرۈنمە يۈز ۋە رەندر",
  compactMobileToolbar: "ئىخچام موبىل قورال بالداق",
  showNoteDrawMagicWand: "NoteDraw سېھىرلىك تاياقچىسىنى كۆرسىتىش",
  frontendMode: "ئالدى يۈز ھالىتى",
  editableNote: "تەھرىرلىنىدىغان خاتىرە",
  fullWebPage: "تولۇق توربەت",
  autoSaveWebNotes: "تور خاتىرىلىرىنى ئاپتوماتىك ساقلاش",
  pageZoom: "بەت چوڭايتىش",
  userAgent: "User Agent",
  mobile: "موبىل",
  desktop: "ئۈستەلئۈستى",
  download: "چۈشۈرۈش",
  downloadFolder: "چۈشۈرۈش قىسقۇچى",
  browserMode: "كۆرگۈچ ھالەتلىرى",
  nightMode: "كېچە ھالىتى",
  eyeProtection: "كۆز قوغداش",
  adBlock: "ئېلان توسۇش",
  markAds: "ئېلاننى بەلگىلەش",
  incognito: "ئىز قالدۇرماسلىق",
  disableJavaScript: "JavaScript نى چەكلەش",
  dataImportExport: "سانلىق مەلۇمات كىرگۈزۈش/چىقىرىش",
  translation: "تەرجىمە",
  scriptsReader: "سىكريپت ۋە ئوقۇش قەۋىتى",
  autofill: "ئاپتوماتىك تولدۇرۇش",
  dataMaintenance: "سانلىق مەلۇمات ئاسراش",
  clear: "تازىلاش",
  create: "قۇرۇش",
  supportCodes: "قوللاش كودلىرى",
  searchOrEnterUrl: "ئىزدەڭ ياكى URL كىرگۈزۈڭ",
  go: "بېرىش",
  more: "تېخىمۇ كۆپ",
  ready: "تەييار",
  bookmarks: "خەتكۈش",
  history: "تارىخ",
  reading: "كېيىن ئوقۇش",
  downloads: "چۈشۈرۈشلەر",
  console: "خاتىرە",
  back: "قايتىش",
  forward: "ئالدىغا",
  reload: "قايتا يۈكلەش",
  home: "باش بەت",
  note: "خاتىرە",
  web: "تور",
  noteBrowser: "خاتىرە كۆرگۈچ",
  saveMd: "MD ساقلاش",
  bookmark: "خەتكۈش",
  settings: "تەڭشەكلەر",
  search: "ئىزدەش",
  searchBing: "Bing دا ئىزدەش",
  searching: "ئىزدەۋاتىدۇ...",
  moreResults: "تېخىمۇ كۆپ نەتىجە",
  loading: "يۈكلەۋاتىدۇ...",
  reader: "ئوقۇش",
  copyLink: "ئۇلىنىشنى كۆچۈرۈش",
  doodle: "سىزىش",
  links: "ئۇلىنىشلەر",
  saving: "ساقلاۋاتىدۇ...",
  savedPlugin: "پلاگىنغا ساقلانغان",
  open: "ئېچىش",
  copy: "كۆچۈرۈش",
  source: "مەنبە",
  tabs: "بەتكۈچلەر",
  page: "بەت",
  view: "كۆرۈنۈش",
  save: "ساقلاش",
  tools: "قوراللار",
  openInBrowser: "كۆرگۈچتە ئېچىش",
  share: "ھەمبەھىرلەش",
  zoomOut: "كىچىكلىتىش",
  addBookmark: "خەتكۈشكە قوشۇش",
  removeBookmark: "خەتكۈشتىن ئۆچۈرۈش",
  translateAction: "تەرجىمە",
  qrCode: "QR كود",
  copiedLink: "ئۇلىنىش كۆچۈرۈلدى"
};

function commonUi(values: UiDictionary): UiDictionary {
  return values;
}

const UI_TEXT_AR = commonUi({
  clearCookies: "مسح كوكيز الموقع",
  cookiesCleared: "تم مسح كوكيز الموقع",
  uiLanguageDesc: "يتبع افتراضياً لغة Obsidian/النظام. يمكنك أيضاً تثبيت لغة ثابتة للإضافة.",
  coreEntry: "المدخل الأساسي",
  coreEntryDesc: "الصفحة الرئيسية، البحث، مداخل المتصفح وسلوك بدء التشغيل.",
  homePageDesc: "الصفحة الافتراضية التي يفتحها زر الرئيسية.",
  searchUrlDesc: "استخدم {{query}} كعنصر نائب لنص البحث المرمّز.",
  noteBrowserCurrentUrl: "رابط متصفح الملاحظات الحالي",
  noteBrowserCurrentUrlDesc: "الرابط الذي يُستعاد عند فتح المتصفح القائم على الملاحظات.",
  openBrowserDesc: "فتح المتصفح القائم على الملاحظات بسرعة من الإعدادات.",
  openOnStartup: "الفتح عند بدء التشغيل",
  openOnStartupDesc: "يفتح متصفح الملاحظات في وضع القراءة بعد جهوزية تخطيط Obsidian.",
  interfaceRendering: "الواجهة والعرض",
  interfaceRenderingDesc: "التحكم في شريط الجوال، عصا NoteDraw السحرية، طبقة القارئ ومقياس الصفحة.",
  compactMobileToolbar: "شريط جوال مضغوط",
  compactMobileToolbarDesc: "استخدام عناصر تحكم أصغر لشاشات الهواتف.",
  showNoteDrawMagicWand: "إظهار العصا السحرية لـ NoteDraw",
  showNoteDrawMagicWandDesc: "إظهار زر العصا في أسطح Mobile Webviewer عند توفر NoteDraw.",
  readerHint: "تلميح القارئ",
  readerHintDesc: "إظهار تلميحات طبقة القارئ عندما يعرض المتصفح الداخلي صفحات شبيهة بالملاحظات.",
  liveBrowserFirst: "المتصفح الحي أولاً",
  liveBrowserFirstDesc: "عرض سطح WebView الحي فوق طبقة القراءة ذات النمط الملاحظي.",
  frontendMode: "وضع الواجهة الأمامية",
  frontendModeDesc: "الأمام الافتراضي: ملاحظة قابلة للتحرير أو صفحة ويب كاملة.",
  editableNote: "ملاحظة قابلة للتحرير",
  fullWebPage: "صفحة ويب كاملة",
  autoSaveWebNotes: "حفظ تلقائي لملاحظات الويب",
  autoSaveWebNotesDesc: "حفظ نص القارئ المعدّل والرسومات تلقائياً في بيانات الإضافة فقط. استخدم حفظ MD لإضافة ملف Markdown إلى الخزنة.",
  webNoteFolder: "مجلد ملاحظات الويب",
  webNoteFolderDesc: "تُحفظ عمليات التصدير اليدوية عبر حفظ MD هنا داخل الخزنة.",
  pageZoom: "تكبير الصفحة",
  pageZoomDesc: "التكبير الافتراضي لأسطح المتصفح الحي.",
  readerFontSize: "حجم خط القارئ",
  readerFontSizeDesc: "حجم خط طبقة القارئ/ذاكرة التخزين المؤقت.",
  desktopView: "عرض سطح المكتب",
  desktopViewDesc: "استخدام سطح متصفح حي أعرض.",
  userAgent: "وكيل المستخدم",
  userAgentDesc: "يستخدمه الطلبات الداخلية للجلب/البحث/التنزيل وسطح المتصفح الحي حيث يتيح Obsidian التحكم.",
  mobile: "جوال",
  desktop: "سطح المكتب",
  downloadDesc: "حفظ الملفات وHTML وMHT والصفحات دون اتصال.",
  downloadFolder: "مجلد التنزيلات",
  downloadFolderDesc: "الملفات المحفوظة عبر المزيد > تنزيل وHTML وMHT.",
  downloadConnections: "اتصالات التنزيل",
  downloadConnectionsDesc: "اتصالات نطاق بايت متوازية عندما يدعم الخادم التنزيل القابل للاستئناف.",
  browserMode: "أوضاع المتصفح",
  browserModeDesc: "تؤثر هذه المفاتيح على العرض الداخلي لعرض المتصفح ومتصفح الملاحظات.",
  nightMode: "الوضع الليلي",
  nightModeDesc: "يُعتّم هيكل المتصفح الداخلي وأسطح القارئ.",
  eyeProtection: "حماية العين",
  eyeProtectionDesc: "يستخدم لوناً قراءةً ألطف.",
  adBlock: "حجب الإعلانات",
  adBlockDesc: "يزيل حاويات الإعلانات الشائعة حيثما كانت الصفحة متاحة.",
  markAds: "تعليم الإعلانات",
  markAdsDesc: "يعلّم الحاويات المرجّح أنها إعلانية حيثما كانت الصفحة متاحة.",
  incognito: "وضع التخفي",
  incognitoDesc: "يوقف كتابة السجل وذاكرة القارئ المؤقتة.",
  disableJavaScript: "تعطيل JavaScript",
  disableJavaScriptDesc: "يعيد تحميل الصفحات الحية دون allow-scripts في الصندوق الرملي.",
  rotateScreen: "تدوير الشاشة",
  rotateScreenDesc: "يستخدم سطح متصفح أعرض بأسلوب أفقي.",
  dataImportExport: "استيراد وتصدير البيانات",
  dataImportExportDesc: "العلامات المرجعية، قائمة القراءة، السجل، التنزيلات، قواعد السكربتات، ملاحظات الويب والإعدادات الشائعة.",
  universalExport: "تصدير شامل",
  universalExportDesc: "حفظ حزمة JSON محمولة من Mobile Webviewer في مجلد التنزيلات.",
  exportJson: "تصدير JSON",
  copyJson: "نسخ JSON",
  universalImport: "استيراد شامل",
  universalImportDesc: "استيراد JSON من Mobile Webviewer أو HTML للعلامات المرجعية الشائعة أو أسطر روابط من الحافظة. تُدمج البيانات الموجودة.",
  importClipboard: "استيراد من الحافظة",
  translation: "الترجمة",
  translationDesc: "تتبع افتراضياً لغة Obsidian، أو اختر لغة هدف ثابتة.",
  defaultTranslationLanguage: "لغة الترجمة الافتراضية",
  defaultTranslationLanguageDesc: "يُستخدم في المزيد > ترجمة ومنتقي اللغة. خيار اتباع Obsidian يربط الترجمة بلغة واجهة Obsidian الحالية.",
  scriptsReader: "السكربتات وطبقة القارئ",
  scriptsReaderDesc: "CSS وJavaScript لطبقة القارئ وقواعد السكربتات المطابقة للروابط.",
  readerUserScripts: "سكربتات المستخدم للقارئ",
  readerUserScriptsDesc: "تطبيق CSS وJavaScript مخصصة على طبقة القارئ الداخلية.",
  readerCss: "CSS القارئ",
  readerCssDesc: "CSS يُحقن في صفحات القارئ/ذاكرة التخزين المعروضة.",
  readerJavascript: "JavaScript القارئ",
  readerJavascriptDesc: "يعمل مع container وpage وhostName.",
  userScriptRules: "قواعد سكربتات المستخدم",
  rulesCount: "القواعد ({count})",
  rulesDesc: "CSS وJavaScript بمطابقة الروابط لطبقة القارئ الداخلية.",
  addRule: "إضافة قاعدة",
  ruleName: "اسم القاعدة",
  delete: "حذف",
  match: "المطابقة",
  matchDesc: "يدعم السلسلة الفرعية أو أحرف البدل، مثال: *://*.example.com/*",
  css: "CSS",
  cssDesc: "يُحقن في صفحات القارئ المطابقة.",
  javascript: "JavaScript",
  javascriptDesc: "يعمل مع container وpage وhostName وrule.",
  autofill: "التعبئة التلقائية",
  autofillDesc: "يُستخدم في المزيد > تعبئة الصفحة؛ يملأ الحقول الفارغة المتاحة فقط.",
  autofillName: "اسم التعبئة التلقائية",
  autofillEmail: "بريد التعبئة التلقائية",
  autofillPhone: "هاتف التعبئة التلقائية",
  autofillAddress: "عنوان التعبئة التلقائية",
  autofillFieldDesc: "يُستخدم في المزيد > تعبئة الصفحة.",
  dataMaintenance: "صيانة البيانات",
  dataMaintenanceDesc: "مسح سجل التصفح وذاكرة القارئ المؤقتة والتنزيلات وسجلات وحدة التحكم.",
  clearHistory: "مسح السجل",
  clearReaderCache: "مسح ذاكرة القارئ المؤقتة",
  clearDownloads: "مسح التنزيلات",
  readingList: "قائمة القراءة",
  clearConsole: "مسح وحدة التحكم",
  clearBrowsingData: "مسح بيانات التصفح",
  clearBrowsingDataDesc: "يمسح السجل وذاكرة القارئ المؤقتة وسجلات وحدة التحكم. تبقى العلامات المرجعية وقائمة القراءة والملفات.",
  exportBookmarkNote: "تصدير ملاحظة العلامات",
  exportBookmarkNoteDesc: "إنشاء ملاحظة Markdown تحتوي العلامات المرجعية الحالية.",
  clear: "مسح",
  create: "إنشاء",
  savedEntries: "{count} عنصراً محفوظاً.",
  cachedPages: "{count} صفحة مخزنة مؤقتاً.",
  downloadRecords: "{count} سجل تنزيل محفوظ. لا تُحذف الملفات.",
  savedPages: "{count} صفحة محفوظة.",
  consoleEntries: "{count} سجل وحدة تحكم.",
  supportCodes: "رموز الدعم",
  supportCodesDesc: "إذا أفادتك هذا البرنامج الإضافي، امسح الرمز ضوئياً لدعم استمرار الصيانة.",
  searchOrEnterUrl: "ابحث أو أدخل رابطاً",
  go: "انتقال",
  closeMore: "إغلاق المزيد",
  ready: "جاهز",
  closePanel: "إغلاق اللوحة",
  bookmark: "علامة مرجعية",
  saveLink: "حفظ الرابط",
  noReadingListYet: "لا قائمة قراءة بعد",
  noConsoleLogs: "لا سجلات لوحدة التحكم",
  searchingBing: "جارٍ البحث في Bing...",
  resultsCount: "{count} نتيجة",
  loadFailedRetry: "فشل التحميل، أعد المحاولة",
  nativeLightHome: "رئيسية أصلية خفيفة",
  readingStatus: "جارٍ القراءة...",
  pageTools: "أدوات الصفحة",
  doodle: "خربشة",
  closeDoodle: "إغلاق الخربشة",
  editableWebNote: "ملاحظة ويب قابلة للتحرير",
  autoSavedPlugin: "حُفظ تلقائياً في الإضافة",
  saving: "جارٍ الحفظ...",
  savedPlugin: "حُفظ في الإضافة",
  savedMarkdown: "حُفظ في {path}",
  webNoteSaved: "حُفظت ملاحظة الويب في بيانات الإضافة",
  savedTo: "حُفظ في {path}",
  bookmarkAdded: "أُضيفت العلامة المرجعية",
  bookmarkRemoved: "أُزيلت العلامة المرجعية",
  noPreviousPage: "لا صفحة سابقة",
  noNextPage: "لا صفحة تالية",
  internalBrowserTab: "تبويب المتصفح الداخلي",
  refresh: "تحديث",
  openCancip: "فتح Cancip",
  all: "الكل",
  completed: "مكتمل",
  failed: "فاشل",
  today: "اليوم",
  latest: "الأحدث",
  downloadState: "{status} · {progress}%",
  openFile: "فتح",
  copyPath: "نسخ المسار",
  location: "الموقع",
  source: "المصدر",
  cancipDetected: "يُرصد Cancip AI",
  cancipNotEnabled: "Cancip AI غير مفعّل",
  cancipDetectedDesc: "الإصدار {version}؛ افتح لوحة الذكاء الاصطناعي من هنا.",
  cancipNotEnabledDesc: "بعد تثبيت Cancip أو تفعيله، يستطيع Mobile Webviewer توفير سياق الويب الحالي كمدخل ذكاء اصطناعي.",
  copyCurrentContext: "نسخ سياق الويب الحالي",
  sendCurrentToCancip: "إرسال الصفحة الحالية إلى Cancip",
  sentCurrentToCancip: "أُضيفت الصفحة الحالية إلى Cancip",
  cancipContextPrompt: "استخدم سياق الويب هذا للتحليل أو التنظيم أو الاقتباس أو توليد الملاحظات.",
  copiedCancipContext: "نُسخ سياق Cancip",
  downloadComplete: "اكتمل التنزيل: {path}",
  newTab: "تبويب جديد",
  openLink: "فتح الرابط",
  openInNewTab: "فتح في تبويب جديد",
  downloadLink: "تنزيل الرابط",
  downloadSavedTo: "حُفظت التنزيلات في: {folder}",
  tabs: "التبويبات",
  downloadPage: "التنزيلات ({count})",
  bookmarksCount: "العلامات ({count})",
  historyCount: "السجل ({count})",
  readingCount: "القراءة ({count})",
  consoleCount: "السجلات ({count})",
  downloadsCount: "التنزيلات ({count})",
  newObTab: "تبويب OB جديد",
  openNoteWeb: "فتح Note Web",
  openInBrowser: "فتح في المتصفح",
  share: "مشاركة",
  browserStatus: "حالة المتصفح",
  zoomIn: "تكبير {value}%",
  zoomOut: "تصغير",
  dayMode: "الوضع النهاري",
  closeEyeProtection: "إيقاف حماية العين",
  closeAdBlock: "إيقاف حجب الإعلانات",
  adBlocking: "حجب الإعلانات",
  unmarkAds: "إزالة تعليم الإعلانات",
  closeIncognito: "إيقاف وضع التخفي",
  enableJs: "تمكين JS",
  disableJs: "تعطيل JS",
  closeLandscape: "إيقاف الوضع الأفقي",
  landscape: "الوضع الأفقي",
  fontSize: "حجم الخط {value}%",
  downloadFile: "تنزيل ملف",
  saveHtml: "حفظ HTML",
  saveMht: "حفظ MHT",
  offlinePage: "صفحة دون اتصال",
  desktopShortcut: "اختصار سطح المكتب",
  addReadingList: "إضافة لقائمة القراءة",
  autofillPage: "تعبئة الصفحة تلقائياً",
  scriptsCount: "السكربتات ({count})",
  mediaSniff: "كشف الوسائط",
  pageAssets: "موارد الصفحة",
  copySource: "نسخ المصدر",
  viewSource: "عرض المصدر",
  readAloud: "قراءة بصوت عالٍ",
  report: "تقرير",
  copyLogs: "نسخ السجلات",
  clearCache: "مسح ذاكرة التخزين ({count})",
  siteSettings: "إعدادات الموقع",
  toolStatus: "حالة الأدوات",
  clearBrowsingDataAction: "مسح بيانات التصفح",
  runningAction: "قيد التنفيذ: {label}",
  completedAction: "اكتمل: {label}",
  failedAction: "فشل {label}: {message}",
  downloadFinished: "انتهى التنزيل: {path}",
  saved: "حُفظ: {path}",
  addedReadingList: "أُضيف لقائمة القراءة",
  mediaCopied: "نُسخت الوسائط: {count}",
  resourcesCopied: "نُسخت الموارد",
  sourceCopied: "نُسخ المصدر",
  consoleCopied: "نُسخت وحدة التحكم",
  cacheCleared: "مُسحت ذاكرة التخزين المؤقتة",
  browsingDataCleared: "مُسحت بيانات التصفح",
  translatePageTo: "ترجمة الصفحة إلى...",
  newObsidianTab: "تبويب Obsidian جديد",
  address: "العنوان",
  webResultsTab: "الويب",
  imageResultsTab: "الصور",
  videoResultsTab: "الفيديوهات",
  academicTab: "أكاديمي",
  dictionaryTab: "قاموس",
  mapsTab: "الخرائط",
  moreTab: "المزيد",
  aboutResults: "حوالي {count} نتيجة",
  learnMoreAbout: "اعرف المزيد عن {query}",
  webNotePlaceholder: "ملاحظة ويب",
  fallbackEditableNote: "تحميل الصفحة محدود؛ تبقى طبقة ملاحظة قابلة للتحرير.",
  loadingValue: "جارٍ التحميل: {value}",
  yes: "نعم",
  no: "لا",
  downloadDirectory: "مجلد التنزيل: {folder}",
  cancipAi: "Cancip AI",
  currentOpen: "فتح الحالية",
  readerExtracting: "جارٍ استخلاص ملخص الصفحة...",
  insertedLink: "أُدرج الرابط",
  copiedMarkdownLink: "نُسخ رابط Markdown",
  noteDrawDisabled: "إضافة NoteDraw غير مفعّلة.",
  readerNoteNotReady: "ملاحظة القارئ غير جاهزة بعد",
  noWebNoteToExport: "لا ملاحظة ويب للتصدير",
  jsonCopied: "نُسخ JSON الخاص بـ Mobile Webviewer",
  clipboardEmpty: "الحافظة فارغة",
  fileMissingPathCopied: "الملف غير موجود في الخزنة؛ نُسخ المسار",
  htmlSaveFailed: "فشل حفظ HTML",
  mhtSaveFailed: "فشل حفظ MHT",
  shareTextCopied: "نُسخ نص المشاركة",
  downloadFailed: "فشل التنزيل",
  cancipDisabled: "إضافة Cancip غير مفعّلة",
  noWebLinkFound: "لا يوجد رابط ويب",
  bookmarkNoteCreated: "أُنشئت ملاحظة العلامات",
  emptyConsoleDesc: "لا سجلات بعد. ستظهر هنا عمليات البحث والتنزيلات والحفظ والسكربتات.",
  pageSource: "مصدر الصفحة",
  copyReport: "نسخ التقرير",
  reportUrl: "رابط التقرير",
  reportCopied: "نُسخ التقرير",
  urlCopied: "نُسخ الرابط",
  translatePage: "ترجمة الصفحة",
  noSavedPages: "لا صفحات محفوظة",
  noResourcesFound: "لا موارد موجودة",
  disabled: "معطّل",
  noMatchingScripts: "لا سكربتات مطابقة",
  findInPage: "بحث في الصفحة",
  previous: "السابق",
  next: "التالي",
  pageLoadLimited: "تحميل الصفحة محدود؛ تبقى طبقة ملاحظة قابلة للتحرير.",
  systemBrowser: "فتح في متصفح النظام",
  proxyModeActive: "يرفض الموقع التضمين — حُمّلت الصفحة الحقيقية عبر الوكيل المدمج",
  postFormUnsupported: "إرسال نماذج POST غير مدعوم في وضع الوكيل",
  uiLanguage: "لغة الواجهة",
  followObsidian: "اتباع لغة Obsidian",
  homePage: "الصفحة الرئيسية",
  searchUrl: "رابط البحث",
  openBrowser: "فتح المتصفح",
  settings: "الإعدادات",
  more: "المزيد",
  search: "بحث",
  searchBing: "البحث في Bing",
  bookmarks: "الإشارات",
  history: "السجل",
  reading: "قائمة القراءة",
  downloads: "التنزيلات",
  console: "السجل",
  back: "رجوع",
  forward: "تقدم",
  reload: "تحديث",
  home: "الرئيسية",
  note: "ملاحظة",
  web: "ويب",
  noteBrowser: "متصفح الملاحظات",
  saveMd: "حفظ MD",
  download: "تنزيل",
  open: "فتح",
  copy: "نسخ",
  save: "حفظ",
  tools: "أدوات",
  page: "صفحة",
  view: "عرض",
  close: "إغلاق",
  translateAction: "ترجمة",
  qrCode: "رمز QR",
  copyLink: "نسخ الرابط",
  copiedLink: "تم نسخ الرابط",
  loading: "جار التحميل...",
  searching: "جار البحث...",
  moreResults: "المزيد من النتائج",
  noEntries: "لا توجد عناصر",
  noDownloadsYet: "لا توجد تنزيلات",
  noHistoryYet: "لا يوجد سجل",
  noBookmarksYet: "لا توجد إشارات",
  addBookmark: "إضافة إشارة",
  removeBookmark: "إزالة الإشارة",
  mobileVersion: "نسخة الهاتف",
  desktopVersion: "نسخة سطح المكتب",
  fullscreen: "ملء الشاشة",
  exitFullscreen: "الخروج من ملء الشاشة",
  reader: "قارئ",
  links: "روابط"
});

const UI_TEXT_RU = commonUi({
  clearCookies: "Очистить cookie сайта",
  cookiesCleared: "Cookie сайта очищены",
  uiLanguageDesc: "По умолчанию следует языку Obsidian/системы. Можно закрепить фиксированный язык плагина.",
  coreEntry: "Основной вход",
  coreEntryDesc: "Домашняя страница, поиск, входы в браузер и поведение при запуске.",
  homePageDesc: "Страница по умолчанию, открываемая кнопкой «Домой».",
  searchUrlDesc: "{{query}} — заполнитель для закодированного текста поиска.",
  noteBrowserCurrentUrl: "Текущий URL блокнотного браузера",
  noteBrowserCurrentUrlDesc: "URL, восстанавливаемый при открытии браузера на основе заметок.",
  openBrowserDesc: "Быстро открыть браузер на основе заметок из настроек.",
  openOnStartup: "Открывать при запуске",
  openOnStartupDesc: "Открывать браузер на основе заметок в режиме чтения после готовности макета Obsidian.",
  interfaceRendering: "Интерфейс и отрисовка",
  interfaceRenderingDesc: "Управление мобильной панелью, волшебной палочкой NoteDraw, слоем чтения и масштабом страницы.",
  compactMobileToolbar: "Компактная мобильная панель",
  compactMobileToolbarDesc: "Уменьшенные элементы управления для экранов телефонов.",
  showNoteDrawMagicWand: "Показывать волшебную палочку NoteDraw",
  showNoteDrawMagicWandDesc: "Показывать кнопку палочки на поверхностях Mobile Webviewer, когда доступен NoteDraw.",
  readerHint: "Подсказка читалки",
  readerHintDesc: "Показывать подсказки слоя чтения, когда внутренний браузер отображает страницы в виде заметок.",
  liveBrowserFirst: "Живой браузер поверх",
  liveBrowserFirstDesc: "Показывать живую поверхность WebView над слоем чтения в стиле заметок.",
  frontendMode: "Режим переднего плана",
  frontendModeDesc: "Передний план по умолчанию: редактируемая заметка или полная веб-страница.",
  editableNote: "Редактируемая заметка",
  fullWebPage: "Полная веб-страница",
  autoSaveWebNotes: "Автосохранение веб-заметок",
  autoSaveWebNotesDesc: "Автосохранение отредактированного текста читалки и рисунков только в данные плагина. Чтобы добавить Markdown-файл в хранилище, используйте «Сохранить MD».",
  webNoteFolder: "Папка веб-заметок",
  webNoteFolderDesc: "Ручной экспорт через «Сохранить MD» сохраняется здесь внутри хранилища.",
  pageZoom: "Масштаб страницы",
  pageZoomDesc: "Масштаб по умолчанию для живых поверхностей браузера.",
  readerFontSize: "Размер шрифта читалки",
  readerFontSizeDesc: "Размер шрифта слоя чтения/кэша.",
  desktopView: "Вид как на ПК",
  desktopViewDesc: "Использовать более широкую живую поверхность браузера.",
  userAgent: "User Agent",
  userAgentDesc: "Используется внутренними запросами получения/поиска/загрузки и живой поверхностью браузера там, где Obsidian даёт управление.",
  mobile: "Мобильный",
  desktop: "ПК",
  downloadDesc: "Сохранение файлов, HTML, MHT и офлайн-страниц.",
  downloadFolder: "Папка загрузок",
  downloadFolderDesc: "Файлы, сохранённые через «Ещё > Загрузка», HTML и MHT.",
  downloadConnections: "Соединения загрузки",
  downloadConnectionsDesc: "Параллельные диапазонные соединения, если сервер поддерживает докачку.",
  browserMode: "Режимы браузера",
  browserModeDesc: "Эти переключатели влияют на внутреннюю отрисовку Browser View и Note Browser.",
  nightMode: "Ночной режим",
  nightModeDesc: "Затемняет оболочку внутреннего браузера и поверхности читалки.",
  eyeProtection: "Защита глаз",
  eyeProtectionDesc: "Применяет более мягкий оттенок для чтения.",
  adBlock: "Блокировка рекламы",
  adBlockDesc: "Удаляет типовые рекламные контейнеры там, где страница доступна.",
  markAds: "Помечать рекламу",
  markAdsDesc: "Помечает вероятные рекламные контейнеры там, где страница доступна.",
  incognito: "Инкогнито",
  incognitoDesc: "Останавливает запись истории и кэша читалки.",
  disableJavaScript: "Отключить JavaScript",
  disableJavaScriptDesc: "Перезагружает живые страницы без allow-scripts в песочнице.",
  rotateScreen: "Повернуть экран",
  rotateScreenDesc: "Использует более широкую поверхность браузера, как в альбомной ориентации.",
  dataImportExport: "Импорт и экспорт данных",
  dataImportExportDesc: "Закладки, список чтения, история, загрузки, правила скриптов, веб-заметки и общие настройки.",
  universalExport: "Универсальный экспорт",
  universalExportDesc: "Сохранить переносимый JSON-пакет Mobile Webviewer в папку загрузок.",
  exportJson: "Экспорт JSON",
  copyJson: "Копировать JSON",
  universalImport: "Универсальный импорт",
  universalImportDesc: "Импорт JSON Mobile Webviewer, обычного HTML закладок или строк URL из буфера обмена. Существующие данные объединяются.",
  importClipboard: "Импорт из буфера",
  translation: "Перевод",
  translationDesc: "По умолчанию следует языку Obsidian, либо выберите фиксированный целевой язык.",
  defaultTranslationLanguage: "Язык перевода по умолчанию",
  defaultTranslationLanguageDesc: "Используется в «Ещё > Перевести» и в выборе языка. Режим «следовать Obsidian» привязывает перевод к текущему языку интерфейса Obsidian.",
  scriptsReader: "Скрипты и слой чтения",
  scriptsReaderDesc: "CSS и JavaScript слоя чтения, правила скриптов по URL.",
  readerUserScripts: "Пользовательские скрипты читалки",
  readerUserScriptsDesc: "Применять свои CSS и JavaScript к внутреннему слою чтения.",
  readerCss: "CSS читалки",
  readerCssDesc: "CSS, внедряемый в отрисованные страницы читалки/кэша.",
  readerJavascript: "JavaScript читалки",
  readerJavascriptDesc: "Выполняется с container, page и hostName.",
  userScriptRules: "Правила пользовательских скриптов",
  rulesCount: "Правила ({count})",
  rulesDesc: "CSS и JavaScript по совпадению URL для внутреннего слоя чтения.",
  addRule: "Добавить правило",
  ruleName: "Название правила",
  delete: "Удалить",
  match: "Совпадение",
  matchDesc: "Поддерживает подстроку или подстановочные знаки, например *://*.example.com/*",
  css: "CSS",
  cssDesc: "Внедряется в совпавшие страницы читалки.",
  javascript: "JavaScript",
  javascriptDesc: "Выполняется с container, page, hostName и rule.",
  autofill: "Автозаполнение",
  autofillDesc: "Используется в «Ещё > Автозаполнение»; заполняет только доступные пустые поля.",
  autofillName: "Имя для автозаполнения",
  autofillEmail: "Эл. почта для автозаполнения",
  autofillPhone: "Телефон для автозаполнения",
  autofillAddress: "Адрес для автозаполнения",
  autofillFieldDesc: "Используется в «Ещё > Автозаполнение».",
  dataMaintenance: "Обслуживание данных",
  dataMaintenanceDesc: "Очистка истории, кэша читалки, загрузок и журнала консоли.",
  clearHistory: "Очистить историю",
  clearReaderCache: "Очистить кэш читалки",
  clearDownloads: "Очистить загрузки",
  readingList: "Список чтения",
  clearConsole: "Очистить консоль",
  clearBrowsingData: "Очистить данные просмотра",
  clearBrowsingDataDesc: "Очищает историю, кэш читалки и записи консоли. Закладки, список чтения и файлы сохраняются.",
  exportBookmarkNote: "Экспорт заметки закладок",
  exportBookmarkNoteDesc: "Создать Markdown-заметку с текущими закладками.",
  clear: "Очистить",
  create: "Создать",
  savedEntries: "Сохранено записей: {count}.",
  cachedPages: "Кэшировано страниц: {count}.",
  downloadRecords: "Сохранено записей о загрузках: {count}. Файлы не удаляются.",
  savedPages: "Сохранено страниц: {count}.",
  consoleEntries: "Записей консоли: {count}.",
  supportCodes: "Коды поддержки",
  supportCodesDesc: "Если плагин полезен, отсканируйте код, чтобы поддержать дальнейшую разработку.",
  searchOrEnterUrl: "Поиск или ввод URL",
  go: "Перейти",
  closeMore: "Закрыть «Ещё»",
  ready: "Готово",
  closePanel: "Закрыть панель",
  bookmark: "Закладка",
  saveLink: "Сохранить ссылку",
  noReadingListYet: "Список чтения пока пуст",
  noConsoleLogs: "Журналов консоли нет",
  searchingBing: "Поиск в Bing...",
  resultsCount: "Результатов: {count}",
  loadFailedRetry: "Не удалось загрузить, повторите",
  nativeLightHome: "Лёгкая нативная домашняя",
  readingStatus: "Чтение...",
  pageTools: "Инструменты страницы",
  doodle: "Рисунок",
  closeDoodle: "Закрыть рисунок",
  editableWebNote: "Редактируемая веб-заметка",
  autoSavedPlugin: "Автосохранено в плагин",
  saving: "Сохранение...",
  savedPlugin: "Сохранено в плагин",
  savedMarkdown: "Сохранено в {path}",
  webNoteSaved: "Веб-заметка сохранена в данные плагина",
  savedTo: "Сохранено в {path}",
  bookmarkAdded: "Закладка добавлена",
  bookmarkRemoved: "Закладка удалена",
  noPreviousPage: "Нет предыдущей страницы",
  noNextPage: "Нет следующей страницы",
  internalBrowserTab: "Вкладка внутреннего браузера",
  refresh: "Обновить",
  openCancip: "Открыть Cancip",
  all: "Все",
  completed: "Завершено",
  failed: "Ошибка",
  today: "Сегодня",
  latest: "Новейшие",
  downloadState: "{status} · {progress}%",
  openFile: "Открыть",
  copyPath: "Копировать путь",
  location: "Расположение",
  source: "Источник",
  cancipDetected: "Обнаружен Cancip AI",
  cancipNotEnabled: "Cancip AI не включён",
  cancipDetectedDesc: "Версия {version}; отсюда можно открыть AI-панель.",
  cancipNotEnabledDesc: "После установки или включения Cancip Mobile Webviewer сможет передавать текущий веб-контекст как AI-вход.",
  copyCurrentContext: "Копировать текущий веб-контекст",
  sendCurrentToCancip: "Отправить страницу в Cancip",
  sentCurrentToCancip: "Текущая страница добавлена в Cancip",
  cancipContextPrompt: "Используйте этот веб-контекст для анализа, структурирования, цитирования или создания заметок.",
  copiedCancipContext: "Контекст Cancip скопирован",
  downloadComplete: "Загрузка завершена: {path}",
  newTab: "Новая вкладка",
  openLink: "Открыть ссылку",
  openInNewTab: "Открыть в новой вкладке",
  downloadLink: "Скачать ссылку",
  downloadSavedTo: "Загрузки сохранены в: {folder}",
  tabs: "Вкладки",
  downloadPage: "Загрузки ({count})",
  bookmarksCount: "Закладки ({count})",
  historyCount: "История ({count})",
  readingCount: "Чтение ({count})",
  consoleCount: "Журналы ({count})",
  downloadsCount: "Загрузки ({count})",
  newObTab: "Новая вкладка OB",
  openNoteWeb: "Открыть Note Web",
  openInBrowser: "Открыть в браузере",
  share: "Поделиться",
  browserStatus: "Состояние браузера",
  zoomIn: "Увеличить {value}%",
  zoomOut: "Уменьшить",
  dayMode: "Дневной режим",
  closeEyeProtection: "Выключить защиту глаз",
  closeAdBlock: "Выключить блокировку рекламы",
  adBlocking: "Блокировка рекламы",
  unmarkAds: "Снять пометки рекламы",
  closeIncognito: "Выйти из инкогнито",
  enableJs: "Включить JS",
  disableJs: "Отключить JS",
  closeLandscape: "Выключить альбомный режим",
  landscape: "Альбомный режим",
  fontSize: "Размер шрифта {value}%",
  downloadFile: "Скачать файл",
  saveHtml: "Сохранить HTML",
  saveMht: "Сохранить MHT",
  offlinePage: "Офлайн-страница",
  desktopShortcut: "Ярлык на рабочем столе",
  addReadingList: "В список чтения",
  autofillPage: "Автозаполнение страницы",
  scriptsCount: "Скрипты ({count})",
  mediaSniff: "Поиск медиа",
  pageAssets: "Ресурсы страницы",
  copySource: "Копировать исходник",
  viewSource: "Показать исходник",
  readAloud: "Читать вслух",
  report: "Отчёт",
  copyLogs: "Копировать журналы",
  clearCache: "Очистить кэш ({count})",
  siteSettings: "Настройки сайта",
  toolStatus: "Состояние инструментов",
  clearBrowsingDataAction: "Очистить данные просмотра",
  runningAction: "Выполняется: {label}",
  completedAction: "Завершено: {label}",
  failedAction: "{label} не удалось: {message}",
  downloadFinished: "Загрузка завершена: {path}",
  saved: "Сохранено: {path}",
  addedReadingList: "Добавлено в список чтения",
  mediaCopied: "Скопировано медиа: {count}",
  resourcesCopied: "Ресурсы скопированы",
  sourceCopied: "Исходник скопирован",
  consoleCopied: "Консоль скопирована",
  cacheCleared: "Кэш очищен",
  browsingDataCleared: "Данные просмотра очищены",
  translatePageTo: "Перевести страницу на...",
  newObsidianTab: "Новая вкладка Obsidian",
  address: "Адрес",
  webResultsTab: "Веб",
  imageResultsTab: "Картинки",
  videoResultsTab: "Видео",
  academicTab: "Наука",
  dictionaryTab: "Словарь",
  mapsTab: "Карты",
  moreTab: "Ещё",
  aboutResults: "Около {count} результатов",
  learnMoreAbout: "Подробнее о {query}",
  webNotePlaceholder: "Веб-заметка",
  fallbackEditableNote: "Загрузка страницы ограничена; сохранён редактируемый слой заметки.",
  loadingValue: "Загрузка: {value}",
  yes: "Да",
  no: "Нет",
  downloadDirectory: "Каталог загрузок: {folder}",
  cancipAi: "Cancip AI",
  currentOpen: "Открыть текущую",
  readerExtracting: "Извлечение сводки страницы...",
  insertedLink: "Ссылка вставлена",
  copiedMarkdownLink: "Markdown-ссылка скопирована",
  noteDrawDisabled: "Плагин NoteDraw не включён.",
  readerNoteNotReady: "Заметка читалки ещё не готова",
  noWebNoteToExport: "Нет веб-заметки для экспорта",
  jsonCopied: "JSON Mobile Webviewer скопирован",
  clipboardEmpty: "Буфер обмена пуст",
  fileMissingPathCopied: "Файл не найден в хранилище; путь скопирован",
  htmlSaveFailed: "Не удалось сохранить HTML",
  mhtSaveFailed: "Не удалось сохранить MHT",
  shareTextCopied: "Текст для обмена скопирован",
  downloadFailed: "Загрузка не удалась",
  cancipDisabled: "Плагин Cancip не включён",
  noWebLinkFound: "Веб-ссылка не найдена",
  bookmarkNoteCreated: "Заметка закладок создана",
  emptyConsoleDesc: "Журналов пока нет. Здесь появятся поиск, загрузки, сохранения и скрипты.",
  pageSource: "Исходный код страницы",
  copyReport: "Копировать отчёт",
  reportUrl: "URL отчёта",
  reportCopied: "Отчёт скопирован",
  urlCopied: "URL скопирован",
  translatePage: "Перевести страницу",
  noSavedPages: "Нет сохранённых страниц",
  noResourcesFound: "Ресурсы не найдены",
  disabled: "Отключено",
  noMatchingScripts: "Нет совпадающих скриптов",
  findInPage: "Найти на странице",
  previous: "Назад",
  next: "Далее",
  pageLoadLimited: "Загрузка страницы ограничена; сохранён редактируемый слой заметки.",
  systemBrowser: "Открыть в системном браузере",
  proxyModeActive: "Сайт запрещает встраивание — реальная страница загружена через встроенный прокси",
  postFormUnsupported: "Отправка POST-форм не поддерживается в режиме прокси",
  uiLanguage: "Язык интерфейса",
  followObsidian: "Следовать языку Obsidian",
  homePage: "Домашняя страница",
  searchUrl: "URL поиска",
  openBrowser: "Открыть браузер",
  settings: "Настройки",
  more: "Ещё",
  search: "Поиск",
  searchBing: "Искать в Bing",
  bookmarks: "Закладки",
  history: "История",
  reading: "Список чтения",
  downloads: "Загрузки",
  console: "Журнал",
  back: "Назад",
  forward: "Вперёд",
  reload: "Обновить",
  home: "Домой",
  note: "Заметка",
  web: "Веб",
  noteBrowser: "Браузер заметок",
  saveMd: "Сохранить MD",
  download: "Загрузка",
  open: "Открыть",
  copy: "Копировать",
  save: "Сохранить",
  tools: "Инструменты",
  page: "Страница",
  view: "Вид",
  close: "Закрыть",
  translateAction: "Перевести",
  qrCode: "QR-код",
  copyLink: "Копировать ссылку",
  copiedLink: "Ссылка скопирована",
  loading: "Загрузка...",
  searching: "Поиск...",
  moreResults: "Ещё результаты",
  noEntries: "Нет записей",
  noDownloadsYet: "Нет загрузок",
  noHistoryYet: "Истории нет",
  noBookmarksYet: "Закладок нет",
  addBookmark: "Добавить закладку",
  removeBookmark: "Удалить закладку",
  mobileVersion: "Мобильная версия",
  desktopVersion: "Версия для ПК",
  fullscreen: "Во весь экран",
  exitFullscreen: "Выйти из полноэкранного режима",
  reader: "Чтение",
  links: "Ссылки"
});

const UI_TEXT_TR = commonUi({
  clearCookies: "Site çerezlerini temizle",
  cookiesCleared: "Site çerezleri temizlendi",
  uiLanguageDesc: "Varsayılan olarak Obsidian/sistem dilini izler. İsterseniz eklenti için sabit bir dil seçebilirsiniz.",
  coreEntry: "Temel giriş",
  coreEntryDesc: "Ana sayfa, arama, tarayıcı girişleri ve başlangıç davranışı.",
  homePageDesc: "Giriş düğmesinin açtığı varsayılan sayfa.",
  searchUrlDesc: "Kodlanmış arama metni yerine {{query}} kullanılır.",
  noteBrowserCurrentUrl: "Not tarayıcısı geçerli URL",
  noteBrowserCurrentUrlDesc: "Not tabanlı tarayıcı açıldığında geri yüklenen URL.",
  openBrowserDesc: "Ayarlerden not tabanlı tarayıcıyı hızlıca açar.",
  openOnStartup: "Başlangıçta aç",
  openOnStartupDesc: "Obsidian düzeni hazır olduğunda not tarayıcısını okuma görünümünde açar.",
  interfaceRendering: "Arayüz ve görselleştirme",
  interfaceRenderingDesc: "Mobil araç çubuğu, NoteDraw sihirli değneği, okuyucu katmanı ve sayfa ölçeğini yönetir.",
  compactMobileToolbar: "Kompakt mobil araç çubuğu",
  compactMobileToolbarDesc: "Telefon ekranları için daha küçük kontroller kullanır.",
  showNoteDrawMagicWand: "NoteDraw sihirli değneğini göster",
  showNoteDrawMagicWandDesc: "NoteDraw kullanılabilir olduğunda Mobile Webviewer yüzeylerinde değnek düğmesini gösterir.",
  readerHint: "Okuyucu ipucu",
  readerHintDesc: "Dahili tarayıcı not benzeri sayfalar gösterdiğinde okuyucu katmanı ipuçlarını gösterir.",
  liveBrowserFirst: "Önce canlı tarayıcı",
  liveBrowserFirstDesc: "Not tarzı okuyucu katmanının üzerinde canlı WebView yüzeyini gösterir.",
  frontendMode: "Ön plan modu",
  frontendModeDesc: "Varsayılan ön plan: düzenlenebilir not ya da tam web sayfası.",
  editableNote: "Düzenlenebilir not",
  fullWebPage: "Tam web sayfası",
  autoSaveWebNotes: "Web notlarını otomatik kaydet",
  autoSaveWebNotesDesc: "Düzenlenen okuyucu metnini ve karalamaları yalnızca eklenti verisine otomatik kaydeder. Kasaya Markdown dosyası eklemek için MD kaydet'i kullanın.",
  webNoteFolder: "Web notu klasörü",
  webNoteFolderDesc: "El ile MD kaydet çıktıları kasada buraya kaydedilir.",
  pageZoom: "Sayfa yakınlaştırma",
  pageZoomDesc: "Canlı tarayıcı yüzeyleri için varsayılan yakınlaştırma.",
  readerFontSize: "Okuyucu yazı boyutu",
  readerFontSizeDesc: "Okuyucu/önbellek katmanı yazı boyutu.",
  desktopView: "Masaüstü görünümü",
  desktopViewDesc: "Daha geniş bir canlı tarayıcı yüzeyi kullanır.",
  userAgent: "Kullanıcı ajanı",
  userAgentDesc: "Dahili alma/arama/indirme isteklerinde ve Obsidian'ın kontrol sunduğu canlı tarayıcı yüzeyinde kullanılır.",
  mobile: "Mobil",
  desktop: "Masaüstü",
  downloadDesc: "Dosyaları, HTML, MHT ve çevrimdışı sayfaları kaydeder.",
  downloadFolder: "İndirme klasörü",
  downloadFolderDesc: "Daha fazla > İndir, HTML ve MHT ile kaydedilen dosyalar.",
  downloadConnections: "İndirme bağlantıları",
  downloadConnectionsDesc: "Sunucu devam ettirilebilir indirmeyi destekliyorsa paralel bayt aralığı bağlantıları.",
  browserMode: "Tarayıcı modları",
  browserModeDesc: "Bu anahtarlar Tarayıcı Görünümü ve Not Tarayıcısı iç görselleştirmesini etkiler.",
  nightMode: "Gece modu",
  nightModeDesc: "Dahili tarayıcı kabuğunu ve okuyucu yüzeylerini karartır.",
  eyeProtection: "Göz koruması",
  eyeProtectionDesc: "Daha yumuşak bir okuma tonu uygular.",
  adBlock: "Reklam engelleme",
  adBlockDesc: "Sayfaya erişilebiliyorsa yaygın reklam kapsayıcılarını kaldırır.",
  markAds: "Reklamları işaretle",
  markAdsDesc: "Sayfaya erişilebiliyorsa olası reklam kapsayıcılarını işaretler.",
  incognito: "Gizli",
  incognitoDesc: "Geçmiş ve okuyucu önbelleği yazmayı durdurur.",
  disableJavaScript: "JavaScript'i devre dışı bırak",
  disableJavaScriptDesc: "Canlı sayfaları sandbox'ta allow-scripts olmadan yeniden yükler.",
  rotateScreen: "Ekranı döndür",
  rotateScreenDesc: "Daha geniş yatay benzeri tarayıcı yüzeyi kullanır.",
  dataImportExport: "Veri içe/dışa aktarma",
  dataImportExportDesc: "Yer imleri, okuma listesi, geçmiş, indirmeler, komut dosyası kuralları, web notları ve yaygın ayarlar.",
  universalExport: "Evrensel dışa aktarma",
  universalExportDesc: "Taşınabilir Mobile Webviewer JSON paketini indirme klasörüne kaydeder.",
  exportJson: "JSON dışa aktar",
  copyJson: "JSON kopyala",
  universalImport: "Evrensel içe aktarma",
  universalImportDesc: "Panodan Mobile Webviewer JSON, yaygın yer imi HTML veya düz URL satırlarını içe aktarır. Mevcut veriler birleştirilir.",
  importClipboard: "Panodan içe aktar",
  translation: "Çeviri",
  translationDesc: "Varsayılan olarak Obsidian dilini izler ya da sabit bir hedef dil seçin.",
  defaultTranslationLanguage: "Varsayılan çeviri dili",
  defaultTranslationLanguageDesc: "Daha fazla > Çevir ve dil seçicide kullanılır. Obsidian'ı izleme, çeviriyi Obsidian'ın geçerli arayüz diline bağlar.",
  scriptsReader: "Komut dosyaları ve okuyucu katmanı",
  scriptsReaderDesc: "Okuyucu katmanı CSS ve JavaScript'i ile URL eşleşmeli komut dosyası kuralları.",
  readerUserScripts: "Okuyucu kullanıcı komut dosyaları",
  readerUserScriptsDesc: "Dahili okuyucu katmanına özel CSS ve JavaScript uygular.",
  readerCss: "Okuyucu CSS",
  readerCssDesc: "Oluşturulan okuyucu/önbellek sayfalarına enjekte edilen CSS.",
  readerJavascript: "Okuyucu JavaScript",
  readerJavascriptDesc: "container, page ve hostName ile çalışır.",
  userScriptRules: "Kullanıcı komut dosyası kuralları",
  rulesCount: "Kurallar ({count})",
  rulesDesc: "Dahili okuyucu katmanı için URL eşleşmeli CSS ve JavaScript.",
  addRule: "Kural ekle",
  ruleName: "Kural adı",
  delete: "Sil",
  match: "Eşleşme",
  matchDesc: "Alt dize veya joker destekler, örneğin *://*.example.com/*",
  css: "CSS",
  cssDesc: "Eşleşen okuyucu sayfalarına enjekte edilir.",
  javascript: "JavaScript",
  javascriptDesc: "container, page, hostName ve rule ile çalışır.",
  autofill: "Otomatik doldurma",
  autofillDesc: "Daha fazla > Sayfayı doldur'da kullanılır; yalnızca erişilebilir boş alanları doldurur.",
  autofillName: "Otomatik doldurma adı",
  autofillEmail: "Otomatik doldurma e-posta",
  autofillPhone: "Otomatik doldurma telefon",
  autofillAddress: "Otomatik doldurma adresi",
  autofillFieldDesc: "Daha fazla > Sayfayı doldur'da kullanılır.",
  dataMaintenance: "Veri bakımı",
  dataMaintenanceDesc: "Gezinme geçmişini, okuyucu önbelleğini, indirmeleri ve konsol günlüklerini temizler.",
  clearHistory: "Geçmişi temizle",
  clearReaderCache: "Okuyucu önbelleğini temizle",
  clearDownloads: "İndirmeleri temizle",
  readingList: "Okuma listesi",
  clearConsole: "Konsolu temizle",
  clearBrowsingData: "Gezinme verilerini temizle",
  clearBrowsingDataDesc: "Geçmişi, okuyucu önbelleğini ve konsol kayıtlarını temizler. Yer imleri, okuma listesi ve dosyalar korunur.",
  exportBookmarkNote: "Yer imi notunu dışa aktar",
  exportBookmarkNoteDesc: "Geçerli yer imlerini içeren bir Markdown notu oluşturur.",
  clear: "Temizle",
  create: "Oluştur",
  savedEntries: "{count} kayıt kaydedildi.",
  cachedPages: "{count} sayfa önbelleğe alındı.",
  downloadRecords: "{count} indirme kaydı kaydedildi. Dosyalar kaldırılmaz.",
  savedPages: "{count} sayfa kaydedildi.",
  consoleEntries: "{count} konsol kaydı.",
  supportCodes: "Destek kodları",
  supportCodesDesc: "Bu eklenti işinize yarıyorsa, sürekli bakımı desteklemek için bir kodu tarayın.",
  searchOrEnterUrl: "Ara veya URL gir",
  go: "Git",
  closeMore: "Daha fazla panelini kapat",
  ready: "Hazır",
  closePanel: "Paneli kapat",
  bookmark: "Yer imi",
  saveLink: "Bağlantıyı kaydet",
  noReadingListYet: "Henüz okuma listesi yok",
  noConsoleLogs: "Konsol günlüğü yok",
  searchingBing: "Bing'de aranıyor...",
  resultsCount: "{count} sonuç",
  loadFailedRetry: "Yükleme başarısız, yeniden deneyin",
  nativeLightHome: "Yerli hafif giriş sayfası",
  readingStatus: "Okunuyor...",
  pageTools: "Sayfa araçları",
  doodle: "Karalama",
  closeDoodle: "Karalamayı kapat",
  editableWebNote: "Düzenlenebilir web notu",
  autoSavedPlugin: "Eklentiye otomatik kaydedildi",
  saving: "Kaydediliyor...",
  savedPlugin: "Eklentiye kaydedildi",
  savedMarkdown: "{path} konumuna kaydedildi",
  webNoteSaved: "Web notu eklenti verisine kaydedildi",
  savedTo: "{path} konumuna kaydedildi",
  bookmarkAdded: "Yer imi eklendi",
  bookmarkRemoved: "Yer imi kaldırıldı",
  noPreviousPage: "Önceki sayfa yok",
  noNextPage: "Sonraki sayfa yok",
  internalBrowserTab: "Dahili tarayıcı sekmesi",
  refresh: "Yenile",
  openCancip: "Cancip'i aç",
  all: "Tümü",
  completed: "Tamamlandı",
  failed: "Başarısız",
  today: "Bugün",
  latest: "En yeni",
  downloadState: "{status} · {progress}%",
  openFile: "Aç",
  copyPath: "Yolu kopyala",
  location: "Konum",
  source: "Kaynak",
  cancipDetected: "Cancip AI algılandı",
  cancipNotEnabled: "Cancip AI etkin değil",
  cancipDetectedDesc: "Sürüm {version}; yapay zekâ panelini buradan açın.",
  cancipNotEnabledDesc: "Cancip kurulup etkinleştirildikten sonra Mobile Webviewer geçerli web bağlamını bir yapay zekâ girişi olarak sunabilir.",
  copyCurrentContext: "Geçerli web bağlamını kopyala",
  sendCurrentToCancip: "Geçerli sayfayı Cancip'e gönder",
  sentCurrentToCancip: "Geçerli sayfa Cancip'e eklendi",
  cancipContextPrompt: "Analiz, düzenleme, alıntılama veya not oluşturma için bu web bağlamını kullanın.",
  copiedCancipContext: "Cancip bağlamı kopyalandı",
  downloadComplete: "İndirme tamamlandı: {path}",
  newTab: "Yeni sekme",
  openLink: "Bağlantıyı aç",
  openInNewTab: "Yeni sekmede aç",
  downloadLink: "Bağlantıyı indir",
  downloadSavedTo: "İndirmeler kaydedildi: {folder}",
  tabs: "Sekmeler",
  downloadPage: "İndirmeler ({count})",
  bookmarksCount: "Yer imleri ({count})",
  historyCount: "Geçmiş ({count})",
  readingCount: "Okuma ({count})",
  consoleCount: "Günlükler ({count})",
  downloadsCount: "İndirmeler ({count})",
  newObTab: "Yeni OB sekmesi",
  openNoteWeb: "Note Web'i aç",
  openInBrowser: "Tarayıcıda aç",
  share: "Paylaş",
  browserStatus: "Tarayıcı durumu",
  zoomIn: "Büyüt {value}%",
  zoomOut: "Küçült",
  dayMode: "Gündüz modu",
  closeEyeProtection: "Göz korumasını kapat",
  closeAdBlock: "Reklam engellemeyi kapat",
  adBlocking: "Reklam engelleme",
  unmarkAds: "Reklam işaretini kaldır",
  closeIncognito: "Gizli moddan çık",
  enableJs: "JS'yi etkinleştir",
  disableJs: "JS'yi devre dışı bırak",
  closeLandscape: "Yatay modu kapat",
  landscape: "Yatay mod",
  fontSize: "Yazı boyutu {value}%",
  downloadFile: "Dosya indir",
  saveHtml: "HTML kaydet",
  saveMht: "MHT kaydet",
  offlinePage: "Çevrimdışı sayfa",
  desktopShortcut: "Masaüstü kısayolu",
  addReadingList: "Okuma listesine ekle",
  autofillPage: "Sayfayı doldur",
  scriptsCount: "Komut dosyaları ({count})",
  mediaSniff: "Medya algılama",
  pageAssets: "Sayfa kaynakları",
  copySource: "Kaynağı kopyala",
  viewSource: "Kaynağı görüntüle",
  readAloud: "Sesli oku",
  report: "Rapor",
  copyLogs: "Günlükleri kopyala",
  clearCache: "Önbelleği temizle ({count})",
  siteSettings: "Site ayarları",
  toolStatus: "Araç durumu",
  clearBrowsingDataAction: "Gezinme verilerini temizle",
  runningAction: "Çalışıyor: {label}",
  completedAction: "Tamamlandı: {label}",
  failedAction: "{label} başarısız: {message}",
  downloadFinished: "İndirme bitti: {path}",
  saved: "Kaydedildi: {path}",
  addedReadingList: "Okuma listesine eklendi",
  mediaCopied: "Medya kopyalandı: {count}",
  resourcesCopied: "Kaynaklar kopyalandı",
  sourceCopied: "Kaynak kopyalandı",
  consoleCopied: "Konsol kopyalandı",
  cacheCleared: "Önbellek temizlendi",
  browsingDataCleared: "Gezinme verileri temizlendi",
  translatePageTo: "Sayfayı şu dile çevir...",
  newObsidianTab: "Yeni Obsidian sekmesi",
  address: "Adres",
  webResultsTab: "Web",
  imageResultsTab: "Görseller",
  videoResultsTab: "Videolar",
  academicTab: "Akademik",
  dictionaryTab: "Sözlük",
  mapsTab: "Haritalar",
  moreTab: "Daha fazla",
  aboutResults: "Yaklaşık {count} sonuç",
  learnMoreAbout: "{query} hakkında daha fazla bilgi",
  webNotePlaceholder: "Web notu",
  fallbackEditableNote: "Sayfa yükleme sınırlı; düzenlenebilir not katmanı korunur.",
  loadingValue: "Yükleniyor: {value}",
  yes: "Evet",
  no: "Hayır",
  downloadDirectory: "İndirme dizini: {folder}",
  cancipAi: "Cancip AI",
  currentOpen: "Geçerliyi aç",
  readerExtracting: "Sayfa özeti çıkarılıyor...",
  insertedLink: "Bağlantı eklendi",
  copiedMarkdownLink: "Markdown bağlantısı kopyalandı",
  noteDrawDisabled: "NoteDraw eklentisi etkin değil.",
  readerNoteNotReady: "Okuyucu notu henüz hazır değil",
  noWebNoteToExport: "Dışa aktarılacak web notu yok",
  jsonCopied: "Mobile Webviewer JSON kopyalandı",
  clipboardEmpty: "Pano boş",
  fileMissingPathCopied: "Dosya kasada bulunamadı; yol kopyalandı",
  htmlSaveFailed: "HTML kaydetme başarısız",
  mhtSaveFailed: "MHT kaydetme başarısız",
  shareTextCopied: "Paylaşım metni kopyalandı",
  downloadFailed: "İndirme başarısız",
  cancipDisabled: "Cancip eklentisi etkin değil",
  noWebLinkFound: "Web bağlantısı bulunamadı",
  bookmarkNoteCreated: "Yer imi notu oluşturuldu",
  emptyConsoleDesc: "Henüz günlük yok. Arama, indirme, kaydetme ve komut dosyası kayıtları burada görünecek.",
  pageSource: "Sayfa kaynağı",
  copyReport: "Raporu kopyala",
  reportUrl: "Rapor URL'si",
  reportCopied: "Rapor kopyalandı",
  urlCopied: "URL kopyalandı",
  translatePage: "Sayfayı çevir",
  noSavedPages: "Kaydedilmiş sayfa yok",
  noResourcesFound: "Kaynak bulunamadı",
  disabled: "Devre dışı",
  noMatchingScripts: "Eşleşen komut dosyası yok",
  findInPage: "Sayfada bul",
  previous: "Önceki",
  next: "Sonraki",
  pageLoadLimited: "Sayfa yükleme sınırlı; düzenlenebilir not katmanı korunur.",
  systemBrowser: "Sistem tarayıcısında aç",
  proxyModeActive: "Site gömmeyi reddetti — gerçek sayfa yerleşik proxy ile yüklendi",
  postFormUnsupported: "Proxy modunda POST form gönderimi desteklenmiyor",
  uiLanguage: "Arayüz dili",
  followObsidian: "Obsidian dilini izle",
  homePage: "Ana sayfa",
  searchUrl: "Arama URL'si",
  openBrowser: "Tarayıcıyı aç",
  settings: "Ayarlar",
  more: "Daha fazla",
  search: "Ara",
  searchBing: "Bing'de ara",
  bookmarks: "Yer imleri",
  history: "Geçmiş",
  reading: "Okuma listesi",
  downloads: "İndirilenler",
  console: "Günlük",
  back: "Geri",
  forward: "İleri",
  reload: "Yenile",
  home: "Ana sayfa",
  note: "Not",
  web: "Web",
  noteBrowser: "Not tarayıcı",
  saveMd: "MD kaydet",
  download: "İndir",
  open: "Aç",
  copy: "Kopyala",
  save: "Kaydet",
  tools: "Araçlar",
  page: "Sayfa",
  view: "Görünüm",
  close: "Kapat",
  translateAction: "Çevir",
  qrCode: "QR kod",
  copyLink: "Bağlantıyı kopyala",
  copiedLink: "Bağlantı kopyalandı",
  loading: "Yükleniyor...",
  searching: "Aranıyor...",
  moreResults: "Daha fazla sonuç",
  noEntries: "Kayıt yok",
  noDownloadsYet: "İndirme yok",
  noHistoryYet: "Geçmiş yok",
  noBookmarksYet: "Yer imi yok",
  addBookmark: "Yer imi ekle",
  removeBookmark: "Yer imini kaldır",
  mobileVersion: "Mobil sürüm",
  desktopVersion: "Masaüstü sürüm",
  fullscreen: "Tam ekran",
  exitFullscreen: "Tam ekrandan çık",
  reader: "Okuyucu",
  links: "Bağlantılar"
});

const UI_TEXT_JA = commonUi({
  clearCookies: "サイトのCookieを消去",
  cookiesCleared: "サイトのCookieを消去しました",
  uiLanguageDesc: "デフォルトでは Obsidian/システムの言語に従います。プラグインの言語を固定することもできます。",
  coreEntry: "基本エントリー",
  coreEntryDesc: "ホームページ、検索、ブラウザーの入口と起動時の動作。",
  homePageDesc: "ホームボタンで開かれる既定のページ。",
  searchUrlDesc: "{{query}} がエンコード済み検索語のプレースホルダーになります。",
  noteBrowserCurrentUrl: "ノートブラウザーの現在の URL",
  noteBrowserCurrentUrlDesc: "ノートベースのブラウザーを開くときに復元される URL。",
  openBrowserDesc: "設定からノートベースのブラウザーを素早く開きます。",
  openOnStartup: "起動時に開く",
  openOnStartupDesc: "Obsidian のレイアウト準備後にノートブラウザーを読み取りビューで開きます。",
  interfaceRendering: "インターフェースと描画",
  interfaceRenderingDesc: "モバイルツールバー、NoteDraw のワンド、リーダーレイヤー、ページ拡大率を制御します。",
  compactMobileToolbar: "コンパクトなモバイルツールバー",
  compactMobileToolbarDesc: "スマホ画面向けに小さめのコントロールを使います。",
  showNoteDrawMagicWand: "NoteDraw の魔法の杖を表示",
  showNoteDrawMagicWandDesc: "NoteDraw が利用可能なとき、Mobile Webviewer の画面に杖ボタンを表示します。",
  readerHint: "リーダーヒント",
  readerHintDesc: "内部ブラウザーがノート風ページを描画する際にリーダーレイヤーのヒントを表示します。",
  liveBrowserFirst: "ライブブラウザー優先",
  liveBrowserFirstDesc: "ノート風リーダーレイヤーの上にライブ WebView を表示します。",
  frontendMode: "フロントモード",
  frontendModeDesc: "既定の前面：編集可能なノートか完全な Web ページか。",
  editableNote: "編集可能なノート",
  fullWebPage: "完全な Web ページ",
  autoSaveWebNotes: "ウェブノートの自動保存",
  autoSaveWebNotesDesc: "編集したリーダーテキストと落書きをプラグインデータにのみ自動保存します。Vault に Markdown ファイルを追加するには Save MD を使います。",
  webNoteFolder: "ウェブノートフォルダー",
  webNoteFolderDesc: "手動の Save MD 出力はこのフォルダーに保存されます。",
  pageZoom: "ページ拡大率",
  pageZoomDesc: "ライブブラウザー画面の既定の拡大率。",
  readerFontSize: "リーダー文字サイズ",
  readerFontSizeDesc: "リーダー/キャッシュレイヤーの文字サイズ。",
  desktopView: "デスクトップ表示",
  desktopViewDesc: "より広いライブブラウザー画面を使います。",
  userAgent: "ユーザーエージェント",
  userAgentDesc: "内部の取得/検索/ダウンロード要求と、Obsidian が制御を公開しているライブブラウザー画面に使用されます。",
  mobile: "モバイル",
  desktop: "デスクトップ",
  downloadDesc: "ファイル、HTML、MHT、オフラインページを保存します。",
  downloadFolder: "ダウンロードフォルダー",
  downloadFolderDesc: "その他 > ダウンロード、HTML、MHT で保存されるファイル。",
  downloadConnections: "ダウンロード接続数",
  downloadConnectionsDesc: "サーバーがレジューム対応の場合の並列バイトレンジ接続。",
  browserMode: "ブラウザーモード",
  browserModeDesc: "これらのスイッチはブラウザービューとノートブラウザーの内部描画に影響します。",
  nightMode: "ナイトモード",
  nightModeDesc: "内部ブラウザーのシェルとリーダー画面を暗くします。",
  eyeProtection: "目の保護",
  eyeProtectionDesc: "やわらかい読書色を適用します。",
  adBlock: "広告ブロック",
  adBlockDesc: "アクセスできるページで一般的な広告コンテナーを除去します。",
  markAds: "広告マーク",
  markAdsDesc: "アクセスできるページで広告の可能性が高いコンテナーをマークします。",
  incognito: "シークレット",
  incognitoDesc: "履歴とリーダーキャッシュへの書き込みを止めます。",
  disableJavaScript: "JavaScript を無効化",
  disableJavaScriptDesc: "ライブページを sandbox の allow-scripts なしで再読み込みします。",
  rotateScreen: "画面の回転",
  rotateScreenDesc: "より広い横向き風のブラウザー画面を使います。",
  dataImportExport: "データの入出力",
  dataImportExportDesc: "ブックマーク、読書リスト、履歴、ダウンロード、スクリプトルール、ウェブノート、共通設定。",
  universalExport: "ユニバーサル書き出し",
  universalExportDesc: "ポータブルな Mobile Webviewer JSON パッケージをダウンロードフォルダーに保存します。",
  exportJson: "JSON を書き出す",
  copyJson: "JSON をコピー",
  universalImport: "ユニバーサル読み込み",
  universalImportDesc: "クリップボードから Mobile Webviewer JSON、一般的なブックマーク HTML、または URL 行を読み込みます。既存データは統合されます。",
  importClipboard: "クリップボードから読み込む",
  translation: "翻訳",
  translationDesc: "既定では Obsidian の言語に従うか、固定のターゲット言語を選択します。",
  defaultTranslationLanguage: "既定の翻訳言語",
  defaultTranslationLanguageDesc: "その他 > 翻訳と言語ピッカーで使用します。Obsidian の言語に従う場合、翻訳は Obsidian の現在の UI 言語に連動します。",
  scriptsReader: "スクリプトとリーダーレイヤー",
  scriptsReaderDesc: "リーダーレイヤーの CSS、JavaScript、URL マッチのスクリプトルール。",
  readerUserScripts: "リーダーユーザースクリプト",
  readerUserScriptsDesc: "内部リーダーレイヤーにカスタム CSS と JavaScript を適用します。",
  readerCss: "リーダー CSS",
  readerCssDesc: "描画済みリーダー/キャッシュページに注入される CSS。",
  readerJavascript: "リーダー JavaScript",
  readerJavascriptDesc: "container、page、hostName 付きで実行されます。",
  userScriptRules: "ユーザースクリプトルール",
  rulesCount: "ルール（{count}）",
  rulesDesc: "内部リーダーレイヤー向けの URL マッチ CSS と JavaScript。",
  addRule: "ルールを追加",
  ruleName: "ルール名",
  delete: "削除",
  match: "マッチ",
  matchDesc: "部分一致かワイルドカードをサポート、例：*://*.example.com/*",
  css: "CSS",
  cssDesc: "マッチしたリーダーページに注入されます。",
  javascript: "JavaScript",
  javascriptDesc: "container、page、hostName、rule 付きで実行されます。",
  autofill: "オートフィル",
  autofillDesc: "その他 > ページをオートフィル で使用。アクセス可能な空欄のみ埋めます。",
  autofillName: "オートフィル名",
  autofillEmail: "オートフィルメール",
  autofillPhone: "オートフィル電話",
  autofillAddress: "オートフィル住所",
  autofillFieldDesc: "その他 > ページをオートフィル で使用します。",
  dataMaintenance: "データ管理",
  dataMaintenanceDesc: "閲覧履歴、リーダーキャッシュ、ダウンロード、コンソールログを消去します。",
  clearHistory: "履歴を消去",
  clearReaderCache: "リーダーキャッシュを消去",
  clearDownloads: "ダウンロードを消去",
  readingList: "読書リスト",
  clearConsole: "コンソールを消去",
  clearBrowsingData: "閲覧データを消去",
  clearBrowsingDataDesc: "履歴、リーダーキャッシュ、コンソールを消去します。ブックマーク、読書リスト、ファイルは保持されます。",
  exportBookmarkNote: "ブックマークノートを書き出す",
  exportBookmarkNoteDesc: "現在のブックマークを含む Markdown ノートを作成します。",
  clear: "クリア",
  create: "作成",
  savedEntries: "{count} 件のエントリーを保存済み。",
  cachedPages: "{count} ページをキャッシュ済み。",
  downloadRecords: "{count} 件のダウンロード記録を保存済み。ファイルは削除されません。",
  savedPages: "{count} ページを保存済み。",
  consoleEntries: "{count} 件のコンソールエントリー。",
  supportCodes: "支援コード",
  supportCodesDesc: "このプラグインが役に立っているなら、コードをスキャンして開発継続を支援できます。",
  searchOrEnterUrl: "検索または URL を入力",
  go: "移動",
  closeMore: "その他を閉じる",
  ready: "準備完了",
  closePanel: "パネルを閉じる",
  bookmark: "ブックマーク",
  saveLink: "リンクを保存",
  noReadingListYet: "読書リストはまだありません",
  noConsoleLogs: "コンソールログはありません",
  searchingBing: "Bing で検索中...",
  resultsCount: "{count} 件の結果",
  loadFailedRetry: "読み込み失敗、再試行",
  nativeLightHome: "ネイティブ軽量ホーム",
  readingStatus: "読み取り中...",
  pageTools: "ページツール",
  doodle: "落書き",
  closeDoodle: "落書きを閉じる",
  editableWebNote: "編集可能なウェブノート",
  autoSavedPlugin: "プラグインに自動保存済み",
  saving: "保存中...",
  savedPlugin: "プラグインに保存済み",
  savedMarkdown: "{path} に保存しました",
  webNoteSaved: "ウェブノートをプラグインデータに保存しました",
  savedTo: "{path} に保存しました",
  bookmarkAdded: "ブックマークに追加しました",
  bookmarkRemoved: "ブックマークから削除しました",
  noPreviousPage: "前のページはありません",
  noNextPage: "次のページはありません",
  internalBrowserTab: "内部ブラウザータブ",
  refresh: "更新",
  openCancip: "Cancip を開く",
  all: "すべて",
  completed: "完了",
  failed: "失敗",
  today: "今日",
  latest: "最新",
  downloadState: "{status} · {progress}%",
  openFile: "開く",
  copyPath: "パスをコピー",
  location: "場所",
  source: "ソース",
  cancipDetected: "Cancip AI を検出",
  cancipNotEnabled: "Cancip AI は有効ではありません",
  cancipDetectedDesc: "バージョン {version}。ここから AI パネルを開けます。",
  cancipNotEnabledDesc: "Cancip をインストールまたは有効化すると、Mobile Webviewer は現在のウェブコンテキストを AI 入口として提供できます。",
  copyCurrentContext: "現在のウェブコンテキストをコピー",
  sendCurrentToCancip: "現在のページを Cancip に送る",
  sentCurrentToCancip: "現在のページを Cancip に追加しました",
  cancipContextPrompt: "このウェブコンテキストを使って分析・整理・引用・ノート生成ができます。",
  copiedCancipContext: "Cancip コンテキストをコピーしました",
  downloadComplete: "ダウンロード完了：{path}",
  newTab: "新しいタブ",
  openLink: "リンクを開く",
  openInNewTab: "新しいタブで開く",
  downloadLink: "リンクをダウンロード",
  downloadSavedTo: "ダウンロードの保存先：{folder}",
  tabs: "タブ",
  downloadPage: "ダウンロード（{count}）",
  bookmarksCount: "ブックマーク（{count}）",
  historyCount: "履歴（{count}）",
  readingCount: "読書（{count}）",
  consoleCount: "ログ（{count}）",
  downloadsCount: "ダウンロード（{count}）",
  newObTab: "新しい OB タブ",
  openNoteWeb: "Note Web を開く",
  openInBrowser: "ブラウザーで開く",
  share: "共有",
  browserStatus: "ブラウザー状態",
  zoomIn: "拡大 {value}%",
  zoomOut: "縮小",
  dayMode: "デイモード",
  closeEyeProtection: "目の保護をオフ",
  closeAdBlock: "広告ブロックをオフ",
  adBlocking: "広告ブロック",
  unmarkAds: "広告マークを解除",
  closeIncognito: "シークレットを解除",
  enableJs: "JS を有効化",
  disableJs: "JS を無効化",
  closeLandscape: "横向きを解除",
  landscape: "横向き",
  fontSize: "文字サイズ {value}%",
  downloadFile: "ファイルをダウンロード",
  saveHtml: "HTML 保存",
  saveMht: "MHT 保存",
  offlinePage: "オフラインページ",
  desktopShortcut: "デスクトップショートカット",
  addReadingList: "読書リストに追加",
  autofillPage: "ページをオートフィル",
  scriptsCount: "スクリプト（{count}）",
  mediaSniff: "メディア検出",
  pageAssets: "ページアセット",
  copySource: "ソースをコピー",
  viewSource: "ソースを表示",
  readAloud: "読み上げ",
  report: "レポート",
  copyLogs: "ログをコピー",
  clearCache: "キャッシュを消去（{count}）",
  siteSettings: "サイト設定",
  toolStatus: "ツール状態",
  clearBrowsingDataAction: "閲覧データを消去",
  runningAction: "実行中：{label}",
  completedAction: "完了：{label}",
  failedAction: "{label} が失敗：{message}",
  downloadFinished: "ダウンロード完了：{path}",
  saved: "保存しました：{path}",
  addedReadingList: "読書リストに追加しました",
  mediaCopied: "メディアをコピー：{count}",
  resourcesCopied: "リソースをコピーしました",
  sourceCopied: "ソースをコピーしました",
  consoleCopied: "コンソールをコピーしました",
  cacheCleared: "キャッシュを消去しました",
  browsingDataCleared: "閲覧データを消去しました",
  translatePageTo: "ページを翻訳…",
  newObsidianTab: "新しい Obsidian タブ",
  address: "アドレス",
  webResultsTab: "Web",
  imageResultsTab: "画像",
  videoResultsTab: "動画",
  academicTab: "学術",
  dictionaryTab: "辞書",
  mapsTab: "地図",
  moreTab: "その他",
  aboutResults: "約 {count} 件の結果",
  learnMoreAbout: "{query} について詳しく",
  webNotePlaceholder: "ウェブノート",
  fallbackEditableNote: "ページの読み込みが制限されています。編集可能なノートレイヤーを保持します。",
  loadingValue: "読み込み中：{value}",
  yes: "はい",
  no: "いいえ",
  downloadDirectory: "ダウンロードディレクトリ：{folder}",
  cancipAi: "Cancip AI",
  currentOpen: "現在のページを開く",
  readerExtracting: "ページ概要を抽出中...",
  insertedLink: "リンクを挿入しました",
  copiedMarkdownLink: "Markdown リンクをコピーしました",
  noteDrawDisabled: "NoteDraw プラグインが有効ではありません。",
  readerNoteNotReady: "リーダーノートはまだ準備ができていません",
  noWebNoteToExport: "書き出すウェブノートがありません",
  jsonCopied: "Mobile Webviewer JSON をコピーしました",
  clipboardEmpty: "クリップボードは空です",
  fileMissingPathCopied: "ファイルが Vault に見つかりません。パスをコピーしました",
  htmlSaveFailed: "HTML の保存に失敗しました",
  mhtSaveFailed: "MHT の保存に失敗しました",
  shareTextCopied: "共有テキストをコピーしました",
  downloadFailed: "ダウンロードに失敗しました",
  cancipDisabled: "Cancip プラグインが有効ではありません",
  noWebLinkFound: "ウェブリンクが見つかりません",
  bookmarkNoteCreated: "ブックマークノートを作成しました",
  emptyConsoleDesc: "ログはまだありません。検索、ダウンロード、保存、スクリプトの記録がここに表示されます。",
  pageSource: "ページソース",
  copyReport: "レポートをコピー",
  reportUrl: "レポート URL",
  reportCopied: "レポートをコピーしました",
  urlCopied: "URL をコピーしました",
  translatePage: "ページを翻訳",
  noSavedPages: "保存されたページはありません",
  noResourcesFound: "リソースが見つかりません",
  disabled: "無効",
  noMatchingScripts: "一致するスクリプトはありません",
  findInPage: "ページ内検索",
  previous: "前へ",
  next: "次へ",
  pageLoadLimited: "ページの読み込みが制限されています。編集可能なノートレイヤーを保持します。",
  systemBrowser: "システムブラウザーで開く",
  proxyModeActive: "サイトが埋め込みを拒否 — 内蔵プロキシで実際のページを読み込みました",
  postFormUnsupported: "プロキシモードでは POST フォーム送信に対応していません",
  uiLanguage: "表示言語",
  followObsidian: "Obsidian の言語に従う",
  homePage: "ホームページ",
  searchUrl: "検索 URL",
  openBrowser: "ブラウザを開く",
  settings: "設定",
  more: "その他",
  search: "検索",
  searchBing: "Bing で検索",
  bookmarks: "ブックマーク",
  history: "履歴",
  reading: "リーディングリスト",
  downloads: "ダウンロード",
  console: "ログ",
  back: "戻る",
  forward: "進む",
  reload: "再読み込み",
  home: "ホーム",
  note: "ノート",
  web: "Web",
  noteBrowser: "ノートブラウザ",
  saveMd: "MD 保存",
  download: "ダウンロード",
  open: "開く",
  copy: "コピー",
  save: "保存",
  tools: "ツール",
  page: "ページ",
  view: "表示",
  close: "閉じる",
  translateAction: "翻訳",
  qrCode: "QR コード",
  copyLink: "リンクをコピー",
  copiedLink: "リンクをコピーしました",
  loading: "読み込み中...",
  searching: "検索中...",
  moreResults: "さらに表示",
  noEntries: "項目はありません",
  noDownloadsYet: "ダウンロードはありません",
  noHistoryYet: "履歴はありません",
  noBookmarksYet: "ブックマークはありません",
  addBookmark: "ブックマークに追加",
  removeBookmark: "ブックマークを削除",
  mobileVersion: "モバイル版",
  desktopVersion: "デスクトップ版",
  fullscreen: "全画面",
  exitFullscreen: "全画面を終了",
  reader: "リーダー",
  links: "リンク"
});

const UI_TEXT_KO = commonUi({
  clearCookies: "사이트 쿠키 지우기",
  cookiesCleared: "사이트 쿠키를 지웠습니다",
  uiLanguageDesc: "기본적으로 Obsidian/시스템 언어를 따릅니다. 플러그인 언어를 고정할 수도 있습니다.",
  coreEntry: "기본 진입",
  coreEntryDesc: "홈페이지, 검색, 브라우저 진입점과 시작 동작.",
  homePageDesc: "홈 버튼이 여는 기본 페이지.",
  searchUrlDesc: "{{query}}를 인코딩된 검색어 자리 표시자로 사용합니다.",
  noteBrowserCurrentUrl: "노트 브라우저 현재 URL",
  noteBrowserCurrentUrlDesc: "노트 기반 브라우저를 열 때 복원되는 URL.",
  openBrowserDesc: "설정에서 노트 기반 브라우저를 빠르게 엽니다.",
  openOnStartup: "시작 시 열기",
  openOnStartupDesc: "Obsidian 레이아웃이 준비된 후 노트 브라우저를 읽기 보기로 엽니다.",
  interfaceRendering: "인터페이스와 렌더링",
  interfaceRenderingDesc: "모바일 툴바, NoteDraw 마법봉, 리더 레이어, 페이지 배율을 제어합니다.",
  compactMobileToolbar: "컴팩트 모바일 툴바",
  compactMobileToolbarDesc: "휴대폰 화면에 맞게 작은 컨트롤을 사용합니다.",
  showNoteDrawMagicWand: "NoteDraw 마법봉 표시",
  showNoteDrawMagicWandDesc: "NoteDraw를 사용할 수 있을 때 Mobile Webviewer 화면에 마법봉 버튼을 표시합니다.",
  readerHint: "리더 힌트",
  readerHintDesc: "내부 브라우저가 노트 스타일 페이지를 렌더링할 때 리더 레이어 힌트를 표시합니다.",
  liveBrowserFirst: "라이브 브라우저 우선",
  liveBrowserFirstDesc: "노트 스타일 리더 레이어 위에 라이브 WebView를 표시합니다.",
  frontendMode: "프론트 모드",
  frontendModeDesc: "기본 화면: 편집 가능한 노트 또는 전체 웹페이지.",
  editableNote: "편집 가능한 노트",
  fullWebPage: "전체 웹페이지",
  autoSaveWebNotes: "웹 노트 자동 저장",
  autoSaveWebNotesDesc: "편집한 리더 텍스트와 낙서를 플러그인 데이터에만 자동 저장합니다. 볼트에 Markdown 파일을 추가하려면 Save MD를 사용하세요.",
  webNoteFolder: "웹 노트 폴더",
  webNoteFolderDesc: "수동 Save MD 내보내기가 이 폴더에 저장됩니다.",
  pageZoom: "페이지 배율",
  pageZoomDesc: "라이브 브라우저 화면의 기본 배율.",
  readerFontSize: "리더 글자 크기",
  readerFontSizeDesc: "리더/캐시 레이어의 글자 크기.",
  desktopView: "데스크톱 보기",
  desktopViewDesc: "더 넓은 라이브 브라우저 화면을 사용합니다.",
  userAgent: "사용자 에이전트",
  userAgentDesc: "내부 가져오기/검색/다운로드 요청과 Obsidian이 제어를 노출하는 라이브 브라우저 화면에 사용됩니다.",
  mobile: "모바일",
  desktop: "데스크톱",
  downloadDesc: "파일, HTML, MHT, 오프라인 페이지를 저장합니다.",
  downloadFolder: "다운로드 폴더",
  downloadFolderDesc: "더 보기 > 다운로드, HTML, MHT로 저장한 파일.",
  downloadConnections: "다운로드 연결 수",
  downloadConnectionsDesc: "서버가 이어받기를 지원할 때 병렬 바이트 범위 연결.",
  browserMode: "브라우저 모드",
  browserModeDesc: "이 스위치들은 브라우저 보기와 노트 브라우저의 내부 렌더링에 영향을 줍니다.",
  nightMode: "야간 모드",
  nightModeDesc: "내부 브라우저 셸과 리더 화면을 어둡게 합니다.",
  eyeProtection: "눈 보호",
  eyeProtectionDesc: "부드러운 독서 색조를 적용합니다.",
  adBlock: "광고 차단",
  adBlockDesc: "접근 가능한 페이지에서 일반적인 광고 컨테이너를 제거합니다.",
  markAds: "광고 표시",
  markAdsDesc: "접근 가능한 페이지에서 광고 가능성이 높은 컨테이너를 표시합니다.",
  incognito: "시크릿",
  incognitoDesc: "방문 기록과 리더 캐시 기록을 중단합니다.",
  disableJavaScript: "JavaScript 비활성화",
  disableJavaScriptDesc: "샌드박스에서 allow-scripts 없이 라이브 페이지를 다시 로드합니다.",
  rotateScreen: "화면 회전",
  rotateScreenDesc: "더 넓은 가로형 브라우저 화면을 사용합니다.",
  dataImportExport: "데이터 가져오기/내보내기",
  dataImportExportDesc: "북마크, 읽기 목록, 방문 기록, 다운로드, 스크립트 규칙, 웹 노트, 공통 설정.",
  universalExport: "범용 내보내기",
  universalExportDesc: "휴대용 Mobile Webviewer JSON 패키지를 다운로드 폴더에 저장합니다.",
  exportJson: "JSON 내보내기",
  copyJson: "JSON 복사",
  universalImport: "범용 가져오기",
  universalImportDesc: "클립보드에서 Mobile Webviewer JSON, 일반 북마크 HTML 또는 URL 행을 가져옵니다. 기존 데이터는 병합됩니다.",
  importClipboard: "클립보드에서 가져오기",
  translation: "번역",
  translationDesc: "기본적으로 Obsidian 언어를 따르거나 고정 대상 언어를 선택합니다.",
  defaultTranslationLanguage: "기본 번역 언어",
  defaultTranslationLanguageDesc: "더 보기 > 번역과 언어 선택기에 사용됩니다. Obsidian 언어 따르기는 번역을 Obsidian의 현재 UI 언어에 연동합니다.",
  scriptsReader: "스크립트와 리더 레이어",
  scriptsReaderDesc: "리더 레이어 CSS, JavaScript, URL 매치 스크립트 규칙.",
  readerUserScripts: "리더 사용자 스크립트",
  readerUserScriptsDesc: "내부 리더 레이어에 사용자 지정 CSS와 JavaScript를 적용합니다.",
  readerCss: "리더 CSS",
  readerCssDesc: "렌더링된 리더/캐시 페이지에 주입되는 CSS.",
  readerJavascript: "리더 JavaScript",
  readerJavascriptDesc: "container, page, hostName과 함께 실행됩니다.",
  userScriptRules: "사용자 스크립트 규칙",
  rulesCount: "규칙 ({count})",
  rulesDesc: "내부 리더 레이어를 위한 URL 매치 CSS와 JavaScript.",
  addRule: "규칙 추가",
  ruleName: "규칙 이름",
  delete: "삭제",
  match: "매치",
  matchDesc: "부분 문자열 또는 와일드카드 지원, 예: *://*.example.com/*",
  css: "CSS",
  cssDesc: "매치된 리더 페이지에 주입됩니다.",
  javascript: "JavaScript",
  javascriptDesc: "container, page, hostName, rule과 함께 실행됩니다.",
  autofill: "자동 채우기",
  autofillDesc: "더 보기 > 페이지 자동 채우기에서 사용; 접근 가능한 빈 필드만 채웁니다.",
  autofillName: "자동 채우기 이름",
  autofillEmail: "자동 채우기 이메일",
  autofillPhone: "자동 채우기 전화",
  autofillAddress: "자동 채우기 주소",
  autofillFieldDesc: "더 보기 > 페이지 자동 채우기에서 사용됩니다.",
  dataMaintenance: "데이터 관리",
  dataMaintenanceDesc: "방문 기록, 리더 캐시, 다운로드, 콘솔 로그를 지웁니다.",
  clearHistory: "기록 지우기",
  clearReaderCache: "리더 캐시 지우기",
  clearDownloads: "다운로드 지우기",
  readingList: "읽기 목록",
  clearConsole: "콘솔 지우기",
  clearBrowsingData: "탐색 데이터 지우기",
  clearBrowsingDataDesc: "기록, 리더 캐시, 콘솔 항목을 지웁니다. 북마크, 읽기 목록, 파일은 유지됩니다.",
  exportBookmarkNote: "북마크 노트 내보내기",
  exportBookmarkNoteDesc: "현재 북마크를 담은 Markdown 노트를 만듭니다.",
  clear: "지우기",
  create: "만들기",
  savedEntries: "{count}개 항목이 저장되어 있습니다.",
  cachedPages: "{count}개 페이지가 캐시되어 있습니다.",
  downloadRecords: "{count}개의 다운로드 기록이 저장되어 있습니다. 파일은 삭제되지 않습니다.",
  savedPages: "{count}개 페이지가 저장되어 있습니다.",
  consoleEntries: "{count}개의 콘솔 항목.",
  supportCodes: "후원 코드",
  supportCodesDesc: "이 플러그인이 도움이 된다면 코드를 스캔하여 지속적인 유지 보수를 후원할 수 있습니다.",
  searchOrEnterUrl: "검색 또는 URL 입력",
  go: "이동",
  closeMore: "더 보기 닫기",
  ready: "준비됨",
  closePanel: "패널 닫기",
  bookmark: "북마크",
  saveLink: "링크 저장",
  noReadingListYet: "아직 읽기 목록이 없습니다",
  noConsoleLogs: "콘솔 로그가 없습니다",
  searchingBing: "Bing에서 검색 중...",
  resultsCount: "{count}개 결과",
  loadFailedRetry: "불러오기 실패, 다시 시도",
  nativeLightHome: "네이티브 경량 홈",
  readingStatus: "읽는 중...",
  pageTools: "페이지 도구",
  doodle: "낙서",
  closeDoodle: "낙서 닫기",
  editableWebNote: "편집 가능한 웹 노트",
  autoSavedPlugin: "플러그인에 자동 저장됨",
  saving: "저장 중...",
  savedPlugin: "플러그인에 저장됨",
  savedMarkdown: "{path}에 저장됨",
  webNoteSaved: "웹 노트가 플러그인 데이터에 저장됨",
  savedTo: "{path}에 저장됨",
  bookmarkAdded: "북마크에 추가됨",
  bookmarkRemoved: "북마크에서 제거됨",
  noPreviousPage: "이전 페이지 없음",
  noNextPage: "다음 페이지 없음",
  internalBrowserTab: "내부 브라우저 탭",
  refresh: "새로 고침",
  openCancip: "Cancip 열기",
  all: "전체",
  completed: "완료",
  failed: "실패",
  today: "오늘",
  latest: "최신",
  downloadState: "{status} · {progress}%",
  openFile: "열기",
  copyPath: "경로 복사",
  location: "위치",
  source: "소스",
  cancipDetected: "Cancip AI 감지됨",
  cancipNotEnabled: "Cancip AI가 활성화되지 않음",
  cancipDetectedDesc: "버전 {version}. 여기서 AI 패널을 엽니다.",
  cancipNotEnabledDesc: "Cancip을 설치하거나 활성화하면 Mobile Webviewer가 현재 웹 컨텍스트를 AI 진입점으로 제공할 수 있습니다.",
  copyCurrentContext: "현재 웹 컨텍스트 복사",
  sendCurrentToCancip: "현재 페이지를 Cancip으로 보내기",
  sentCurrentToCancip: "현재 페이지가 Cancip에 추가됨",
  cancipContextPrompt: "이 웹 컨텍스트로 분석, 정리, 발췌 또는 노트 생성을 할 수 있습니다.",
  copiedCancipContext: "Cancip 컨텍스트 복사됨",
  downloadComplete: "다운로드 완료: {path}",
  newTab: "새 탭",
  openLink: "링크 열기",
  openInNewTab: "새 탭에서 열기",
  downloadLink: "링크 다운로드",
  downloadSavedTo: "다운로드 저장 위치: {folder}",
  tabs: "탭",
  downloadPage: "다운로드 ({count})",
  bookmarksCount: "북마크 ({count})",
  historyCount: "기록 ({count})",
  readingCount: "읽기 ({count})",
  consoleCount: "로그 ({count})",
  downloadsCount: "다운로드 ({count})",
  newObTab: "새 OB 탭",
  openNoteWeb: "Note Web 열기",
  openInBrowser: "브라우저에서 열기",
  share: "공유",
  browserStatus: "브라우저 상태",
  zoomIn: "확대 {value}%",
  zoomOut: "축소",
  dayMode: "주간 모드",
  closeEyeProtection: "눈 보호 끄기",
  closeAdBlock: "광고 차단 끄기",
  adBlocking: "광고 차단",
  unmarkAds: "광고 표시 해제",
  closeIncognito: "시크릿 해제",
  enableJs: "JS 켜기",
  disableJs: "JS 끄기",
  closeLandscape: "가로 모드 해제",
  landscape: "가로 모드",
  fontSize: "글자 크기 {value}%",
  downloadFile: "파일 다운로드",
  saveHtml: "HTML 저장",
  saveMht: "MHT 저장",
  offlinePage: "오프라인 페이지",
  desktopShortcut: "데스크톱 바로 가기",
  addReadingList: "읽기 목록에 추가",
  autofillPage: "페이지 자동 채우기",
  scriptsCount: "스크립트 ({count})",
  mediaSniff: "미디어 탐지",
  pageAssets: "페이지 자원",
  copySource: "소스 복사",
  viewSource: "소스 보기",
  readAloud: "소리 내어 읽기",
  report: "보고서",
  copyLogs: "로그 복사",
  clearCache: "캐시 지우기 ({count})",
  siteSettings: "사이트 설정",
  toolStatus: "도구 상태",
  clearBrowsingDataAction: "탐색 데이터 지우기",
  runningAction: "실행 중: {label}",
  completedAction: "완료: {label}",
  failedAction: "{label} 실패: {message}",
  downloadFinished: "다운로드 완료: {path}",
  saved: "저장됨: {path}",
  addedReadingList: "읽기 목록에 추가됨",
  mediaCopied: "미디어 복사됨: {count}",
  resourcesCopied: "자원 복사됨",
  sourceCopied: "소스 복사됨",
  consoleCopied: "콘솔 복사됨",
  cacheCleared: "캐시 지워짐",
  browsingDataCleared: "탐색 데이터 지워짐",
  translatePageTo: "페이지 번역 대상...",
  newObsidianTab: "새 Obsidian 탭",
  address: "주소",
  webResultsTab: "웹",
  imageResultsTab: "이미지",
  videoResultsTab: "동영상",
  academicTab: "학술",
  dictionaryTab: "사전",
  mapsTab: "지도",
  moreTab: "더 보기",
  aboutResults: "약 {count}개 결과",
  learnMoreAbout: "{query}에 대해 더 알아보기",
  webNotePlaceholder: "웹 노트",
  fallbackEditableNote: "페이지 불러오기가 제한됩니다. 편집 가능한 노트 레이어를 유지합니다.",
  loadingValue: "불러오는 중: {value}",
  yes: "예",
  no: "아니요",
  downloadDirectory: "다운로드 디렉터리: {folder}",
  cancipAi: "Cancip AI",
  currentOpen: "현재 페이지 열기",
  readerExtracting: "페이지 요약 추출 중...",
  insertedLink: "링크 삽입됨",
  copiedMarkdownLink: "Markdown 링크 복사됨",
  noteDrawDisabled: "NoteDraw 플러그인이 활성화되지 않았습니다.",
  readerNoteNotReady: "리더 노트가 아직 준비되지 않았습니다",
  noWebNoteToExport: "내보낼 웹 노트가 없습니다",
  jsonCopied: "Mobile Webviewer JSON 복사됨",
  clipboardEmpty: "클립보드가 비어 있습니다",
  fileMissingPathCopied: "볼트에서 파일을 찾을 수 없습니다. 경로를 복사했습니다",
  htmlSaveFailed: "HTML 저장 실패",
  mhtSaveFailed: "MHT 저장 실패",
  shareTextCopied: "공유 텍스트 복사됨",
  downloadFailed: "다운로드 실패",
  cancipDisabled: "Cancip 플러그인이 활성화되지 않았습니다",
  noWebLinkFound: "웹 링크를 찾을 수 없습니다",
  bookmarkNoteCreated: "북마크 노트 생성됨",
  emptyConsoleDesc: "아직 로그가 없습니다. 검색, 다운로드, 저장, 스크립트 기록이 여기에 표시됩니다.",
  pageSource: "페이지 소스",
  copyReport: "보고서 복사",
  reportUrl: "보고서 URL",
  reportCopied: "보고서 복사됨",
  urlCopied: "URL 복사됨",
  translatePage: "페이지 번역",
  noSavedPages: "저장된 페이지 없음",
  noResourcesFound: "자원을 찾을 수 없습니다",
  disabled: "비활성화됨",
  noMatchingScripts: "일치하는 스크립트 없음",
  findInPage: "페이지 내 찾기",
  previous: "이전",
  next: "다음",
  pageLoadLimited: "페이지 불러오기가 제한됩니다. 편집 가능한 노트 레이어를 유지합니다.",
  systemBrowser: "시스템 브라우저로 열기",
  proxyModeActive: "사이트가 임베딩을 거부 — 내장 프록시로 실제 페이지를 불러왔습니다",
  postFormUnsupported: "프록시 모드에서는 POST 양식 제출을 지원하지 않습니다",
  uiLanguage: "인터페이스 언어",
  followObsidian: "Obsidian 언어 따르기",
  homePage: "홈페이지",
  searchUrl: "검색 URL",
  openBrowser: "브라우저 열기",
  settings: "설정",
  more: "더보기",
  search: "검색",
  searchBing: "Bing 검색",
  bookmarks: "북마크",
  history: "기록",
  reading: "읽기 목록",
  downloads: "다운로드",
  console: "로그",
  back: "뒤로",
  forward: "앞으로",
  reload: "새로고침",
  home: "홈",
  note: "노트",
  web: "웹",
  noteBrowser: "노트 브라우저",
  saveMd: "MD 저장",
  download: "다운로드",
  open: "열기",
  copy: "복사",
  save: "저장",
  tools: "도구",
  page: "페이지",
  view: "보기",
  close: "닫기",
  translateAction: "번역",
  qrCode: "QR 코드",
  copyLink: "링크 복사",
  copiedLink: "링크가 복사됨",
  loading: "불러오는 중...",
  searching: "검색 중...",
  moreResults: "결과 더보기",
  noEntries: "항목 없음",
  noDownloadsYet: "다운로드 없음",
  noHistoryYet: "기록 없음",
  noBookmarksYet: "북마크 없음",
  addBookmark: "북마크 추가",
  removeBookmark: "북마크 제거",
  mobileVersion: "모바일 버전",
  desktopVersion: "데스크톱 버전",
  fullscreen: "전체 화면",
  exitFullscreen: "전체 화면 종료",
  reader: "리더",
  links: "링크"
});

const UI_TEXT_FR = commonUi({
  clearCookies: "Effacer les cookies du site",
  cookiesCleared: "Cookies du site effacés",
  uiLanguageDesc: "Suit par défaut la langue d'Obsidian/du système. Vous pouvez aussi fixer une langue pour ce plugin.",
  coreEntry: "Entrée principale",
  coreEntryDesc: "Page d'accueil, recherche, entrées du navigateur et comportement au démarrage.",
  homePageDesc: "Page par défaut ouverte par le bouton accueil.",
  searchUrlDesc: "{{query}} sert de marqueur pour le texte de recherche encodé.",
  noteBrowserCurrentUrl: "URL actuelle du navigateur de notes",
  noteBrowserCurrentUrlDesc: "L'URL restaurée à l'ouverture du navigateur basé sur les notes.",
  openBrowserDesc: "Ouvrir rapidement le navigateur basé sur les notes depuis les réglages.",
  openOnStartup: "Ouvrir au démarrage",
  openOnStartupDesc: "Ouvre le navigateur de notes en vue lecture une fois la disposition d'Obsidian prête.",
  interfaceRendering: "Interface et rendu",
  interfaceRenderingDesc: "Contrôle la barre mobile, la baguette NoteDraw, la couche lecteur et l'échelle de page.",
  compactMobileToolbar: "Barre mobile compacte",
  compactMobileToolbarDesc: "Contrôles plus petits pour les écrans de téléphone.",
  showNoteDrawMagicWand: "Afficher la baguette NoteDraw",
  showNoteDrawMagicWandDesc: "Affiche le bouton baguette dans les surfaces Mobile Webviewer quand NoteDraw est disponible.",
  readerHint: "Aide du lecteur",
  readerHintDesc: "Affiche les aides de la couche lecteur quand le navigateur interne rend des pages façon notes.",
  liveBrowserFirst: "Navigateur vivant en premier",
  liveBrowserFirstDesc: "Affiche la surface WebView vivante au-dessus de la couche lecteur façon notes.",
  frontendMode: "Mode de premier plan",
  frontendModeDesc: "Premier plan par défaut : note éditable ou page web complète.",
  editableNote: "Note éditable",
  fullWebPage: "Page web complète",
  autoSaveWebNotes: "Sauvegarde auto des notes web",
  autoSaveWebNotesDesc: "Enregistre automatiquement le texte du lecteur et les gribouillis dans les données du plugin uniquement. Utilisez Enregistrer MD pour ajouter un fichier Markdown au coffre.",
  webNoteFolder: "Dossier des notes web",
  webNoteFolderDesc: "Les exports manuels via Enregistrer MD sont enregistrés ici dans le coffre.",
  pageZoom: "Zoom de page",
  pageZoomDesc: "Zoom par défaut des surfaces du navigateur vivant.",
  readerFontSize: "Taille de police du lecteur",
  readerFontSizeDesc: "Taille de police de la couche lecteur/cache.",
  desktopView: "Vue ordinateur",
  desktopViewDesc: "Utilise une surface de navigateur vivant plus large.",
  userAgent: "User agent",
  userAgentDesc: "Utilisé par les requêtes internes (récupération, recherche, téléchargement) et la surface du navigateur vivant quand Obsidian expose le contrôle.",
  mobile: "Mobile",
  desktop: "Ordinateur",
  downloadDesc: "Enregistre des fichiers, HTML, MHT et pages hors ligne.",
  downloadFolder: "Dossier de téléchargement",
  downloadFolderDesc: "Fichiers enregistrés via Plus > Télécharger, HTML et MHT.",
  downloadConnections: "Connexions de téléchargement",
  downloadConnectionsDesc: "Connexions parallèles par plage d'octets quand le serveur prend en charge la reprise.",
  browserMode: "Modes du navigateur",
  browserModeDesc: "Ces commutateurs affectent le rendu interne de Browser View et du navigateur de notes.",
  nightMode: "Mode nuit",
  nightModeDesc: "Assombrit la coque du navigateur interne et les surfaces du lecteur.",
  eyeProtection: "Protection des yeux",
  eyeProtectionDesc: "Applique une teinte de lecture plus douce.",
  adBlock: "Bloqueur de pubs",
  adBlockDesc: "Supprime les conteneurs publicitaires courants quand la page est accessible.",
  markAds: "Marquer les pubs",
  markAdsDesc: "Marque les conteneurs probablement publicitaires quand la page est accessible.",
  incognito: "Incognito",
  incognitoDesc: "Stoppe l'écriture de l'historique et du cache lecteur.",
  disableJavaScript: "Désactiver JavaScript",
  disableJavaScriptDesc: "Recharge les pages vivantes sans allow-scripts dans le bac à sable.",
  rotateScreen: "Pivoter l'écran",
  rotateScreenDesc: "Utilise une surface de navigateur plus large, façon paysage.",
  dataImportExport: "Import et export de données",
  dataImportExportDesc: "Favoris, liste de lecture, historique, téléchargements, règles de scripts, notes web et réglages courants.",
  universalExport: "Export universel",
  universalExportDesc: "Enregistre un paquet JSON portable de Mobile Webviewer dans le dossier de téléchargement.",
  exportJson: "Exporter JSON",
  copyJson: "Copier JSON",
  universalImport: "Import universel",
  universalImportDesc: "Importe depuis le presse-papiers un JSON Mobile Webviewer, un HTML de favoris courant ou des lignes d'URL. Les données existantes sont fusionnées.",
  importClipboard: "Importer du presse-papiers",
  translation: "Traduction",
  translationDesc: "Suit par défaut la langue d'Obsidian, ou choisissez une langue cible fixe.",
  defaultTranslationLanguage: "Langue de traduction par défaut",
  defaultTranslationLanguageDesc: "Utilisé par Plus > Traduire et le sélecteur de langue. Suivre Obsidian lie la traduction à la langue d'interface actuelle d'Obsidian.",
  scriptsReader: "Scripts et couche lecteur",
  scriptsReaderDesc: "CSS et JavaScript de la couche lecteur, règles de scripts par URL.",
  readerUserScripts: "Scripts utilisateur du lecteur",
  readerUserScriptsDesc: "Applique CSS et JavaScript personnalisés à la couche lecteur interne.",
  readerCss: "CSS du lecteur",
  readerCssDesc: "CSS injecté dans les pages lecteur/cache rendues.",
  readerJavascript: "JavaScript du lecteur",
  readerJavascriptDesc: "S'exécute avec container, page et hostName.",
  userScriptRules: "Règles de scripts utilisateur",
  rulesCount: "Règles ({count})",
  rulesDesc: "CSS et JavaScript par correspondance d'URL pour la couche lecteur interne.",
  addRule: "Ajouter une règle",
  ruleName: "Nom de la règle",
  delete: "Supprimer",
  match: "Correspondance",
  matchDesc: "Prend en charge sous-chaîne ou joker, par exemple *://*.example.com/*",
  css: "CSS",
  cssDesc: "Injecté dans les pages lecteur correspondantes.",
  javascript: "JavaScript",
  javascriptDesc: "S'exécute avec container, page, hostName et rule.",
  autofill: "Remplissage auto",
  autofillDesc: "Utilisé par Plus > Remplir la page ; ne remplit que les champs vides accessibles.",
  autofillName: "Nom de remplissage",
  autofillEmail: "E-mail de remplissage",
  autofillPhone: "Téléphone de remplissage",
  autofillAddress: "Adresse de remplissage",
  autofillFieldDesc: "Utilisé par Plus > Remplir la page.",
  dataMaintenance: "Maintenance des données",
  dataMaintenanceDesc: "Efface historique, cache lecteur, téléchargements et journaux de console.",
  clearHistory: "Effacer l'historique",
  clearReaderCache: "Effacer le cache lecteur",
  clearDownloads: "Effacer les téléchargements",
  readingList: "Liste de lecture",
  clearConsole: "Effacer la console",
  clearBrowsingData: "Effacer les données de navigation",
  clearBrowsingDataDesc: "Efface historique, cache lecteur et entrées de console. Favoris, liste de lecture et fichiers sont conservés.",
  exportBookmarkNote: "Exporter la note de favoris",
  exportBookmarkNoteDesc: "Crée une note Markdown contenant les favoris actuels.",
  clear: "Effacer",
  create: "Créer",
  savedEntries: "{count} entrées enregistrées.",
  cachedPages: "{count} pages en cache.",
  downloadRecords: "{count} enregistrements de téléchargement. Les fichiers ne sont pas supprimés.",
  savedPages: "{count} pages enregistrées.",
  consoleEntries: "{count} entrées de console.",
  supportCodes: "Codes de soutien",
  supportCodesDesc: "Si ce plugin vous aide, scannez un code pour soutenir sa maintenance continue.",
  searchOrEnterUrl: "Rechercher ou saisir une URL",
  go: "Aller",
  closeMore: "Fermer Plus",
  ready: "Prêt",
  closePanel: "Fermer le panneau",
  bookmark: "Favori",
  saveLink: "Enregistrer le lien",
  noReadingListYet: "Aucune liste de lecture pour l'instant",
  noConsoleLogs: "Aucun journal de console",
  searchingBing: "Recherche Bing...",
  resultsCount: "{count} résultat(s)",
  loadFailedRetry: "Échec du chargement, réessayez",
  nativeLightHome: "Accueil natif léger",
  readingStatus: "Lecture...",
  pageTools: "Outils de page",
  doodle: "Gribouillis",
  closeDoodle: "Fermer le gribouillis",
  editableWebNote: "Note web éditable",
  autoSavedPlugin: "Enregistré auto dans le plugin",
  saving: "Enregistrement...",
  savedPlugin: "Enregistré dans le plugin",
  savedMarkdown: "Enregistré dans {path}",
  webNoteSaved: "Note web enregistrée dans les données du plugin",
  savedTo: "Enregistré dans {path}",
  bookmarkAdded: "Favori ajouté",
  bookmarkRemoved: "Favori retiré",
  noPreviousPage: "Pas de page précédente",
  noNextPage: "Pas de page suivante",
  internalBrowserTab: "Onglet du navigateur interne",
  refresh: "Actualiser",
  openCancip: "Ouvrir Cancip",
  all: "Tout",
  completed: "Terminé",
  failed: "Échoué",
  today: "Aujourd'hui",
  latest: "Plus récents",
  downloadState: "{status} · {progress}%",
  openFile: "Ouvrir",
  copyPath: "Copier le chemin",
  location: "Emplacement",
  source: "Source",
  cancipDetected: "Cancip AI détecté",
  cancipNotEnabled: "Cancip AI n'est pas activé",
  cancipDetectedDesc: "Version {version} ; ouvrez le panneau IA depuis ici.",
  cancipNotEnabledDesc: "Après installation ou activation de Cancip, Mobile Webviewer peut fournir le contexte web actuel comme entrée IA.",
  copyCurrentContext: "Copier le contexte web actuel",
  sendCurrentToCancip: "Envoyer la page actuelle à Cancip",
  sentCurrentToCancip: "Page actuelle ajoutée à Cancip",
  cancipContextPrompt: "Utilisez ce contexte web pour analyser, organiser, extraire des citations ou générer des notes.",
  copiedCancipContext: "Contexte Cancip copié",
  downloadComplete: "Téléchargement terminé : {path}",
  newTab: "Nouvel onglet",
  openLink: "Ouvrir le lien",
  openInNewTab: "Ouvrir dans un nouvel onglet",
  downloadLink: "Télécharger le lien",
  downloadSavedTo: "Téléchargements enregistrés dans : {folder}",
  tabs: "Onglets",
  downloadPage: "Téléchargements ({count})",
  bookmarksCount: "Favoris ({count})",
  historyCount: "Historique ({count})",
  readingCount: "Lecture ({count})",
  consoleCount: "Journaux ({count})",
  downloadsCount: "Téléchargements ({count})",
  newObTab: "Nouvel onglet OB",
  openNoteWeb: "Ouvrir Note Web",
  openInBrowser: "Ouvrir dans le navigateur",
  share: "Partager",
  browserStatus: "État du navigateur",
  zoomIn: "Zoom avant {value}%",
  zoomOut: "Zoom arrière",
  dayMode: "Mode jour",
  closeEyeProtection: "Désactiver la protection des yeux",
  closeAdBlock: "Désactiver le bloqueur",
  adBlocking: "Bloqueur de pubs",
  unmarkAds: "Retirer le marquage des pubs",
  closeIncognito: "Quitter l'incognito",
  enableJs: "Activer JS",
  disableJs: "Désactiver JS",
  closeLandscape: "Quitter le mode paysage",
  landscape: "Paysage",
  fontSize: "Taille de police {value}%",
  downloadFile: "Télécharger le fichier",
  saveHtml: "Enregistrer HTML",
  saveMht: "Enregistrer MHT",
  offlinePage: "Page hors ligne",
  desktopShortcut: "Raccourci bureau",
  addReadingList: "Ajouter à la liste de lecture",
  autofillPage: "Remplir la page",
  scriptsCount: "Scripts ({count})",
  mediaSniff: "Détection de médias",
  pageAssets: "Ressources de page",
  copySource: "Copier la source",
  viewSource: "Voir la source",
  readAloud: "Lire à voix haute",
  report: "Rapport",
  copyLogs: "Copier les journaux",
  clearCache: "Vider le cache ({count})",
  siteSettings: "Réglages du site",
  toolStatus: "État des outils",
  clearBrowsingDataAction: "Effacer les données de navigation",
  runningAction: "En cours : {label}",
  completedAction: "Terminé : {label}",
  failedAction: "{label} a échoué : {message}",
  downloadFinished: "Téléchargement terminé : {path}",
  saved: "Enregistré : {path}",
  addedReadingList: "Ajouté à la liste de lecture",
  mediaCopied: "Médias copiés : {count}",
  resourcesCopied: "Ressources copiées",
  sourceCopied: "Source copiée",
  consoleCopied: "Console copiée",
  cacheCleared: "Cache vidé",
  browsingDataCleared: "Données de navigation effacées",
  translatePageTo: "Traduire la page en...",
  newObsidianTab: "Nouvel onglet Obsidian",
  address: "Adresse",
  webResultsTab: "Web",
  imageResultsTab: "Images",
  videoResultsTab: "Vidéos",
  academicTab: "Académique",
  dictionaryTab: "Dictionnaire",
  mapsTab: "Cartes",
  moreTab: "Plus",
  aboutResults: "Environ {count} résultats",
  learnMoreAbout: "En savoir plus sur {query}",
  webNotePlaceholder: "Note web",
  fallbackEditableNote: "Chargement limité ; une couche de note éditable est conservée.",
  loadingValue: "Chargement : {value}",
  yes: "Oui",
  no: "Non",
  downloadDirectory: "Répertoire de téléchargement : {folder}",
  cancipAi: "Cancip AI",
  currentOpen: "Ouvrir l'actuelle",
  readerExtracting: "Extraction du résumé de page...",
  insertedLink: "Lien inséré",
  copiedMarkdownLink: "Lien Markdown copié",
  noteDrawDisabled: "Le plugin NoteDraw n'est pas activé.",
  readerNoteNotReady: "La note du lecteur n'est pas encore prête",
  noWebNoteToExport: "Aucune note web à exporter",
  jsonCopied: "JSON Mobile Webviewer copié",
  clipboardEmpty: "Le presse-papiers est vide",
  fileMissingPathCopied: "Fichier introuvable dans le coffre ; chemin copié",
  htmlSaveFailed: "Échec de l'enregistrement HTML",
  mhtSaveFailed: "Échec de l'enregistrement MHT",
  shareTextCopied: "Texte de partage copié",
  downloadFailed: "Échec du téléchargement",
  cancipDisabled: "Le plugin Cancip n'est pas activé",
  noWebLinkFound: "Aucun lien web trouvé",
  bookmarkNoteCreated: "Note de favoris créée",
  emptyConsoleDesc: "Aucun journal pour l'instant. Recherches, téléchargements, sauvegardes et scripts apparaîtront ici.",
  pageSource: "Source de la page",
  copyReport: "Copier le rapport",
  reportUrl: "URL du rapport",
  reportCopied: "Rapport copié",
  urlCopied: "URL copiée",
  translatePage: "Traduire la page",
  noSavedPages: "Aucune page enregistrée",
  noResourcesFound: "Aucune ressource trouvée",
  disabled: "Désactivé",
  noMatchingScripts: "Aucun script correspondant",
  findInPage: "Rechercher dans la page",
  previous: "Précédent",
  next: "Suivant",
  pageLoadLimited: "Chargement limité ; une couche de note éditable est conservée.",
  systemBrowser: "Ouvrir dans le navigateur système",
  proxyModeActive: "Le site refuse l'intégration — vraie page chargée via le proxy intégré",
  postFormUnsupported: "L'envoi de formulaires POST n'est pas pris en charge en mode proxy",
  uiLanguage: "Langue de l'interface",
  followObsidian: "Suivre la langue d'Obsidian",
  homePage: "Page d'accueil",
  searchUrl: "URL de recherche",
  openBrowser: "Ouvrir le navigateur",
  settings: "Réglages",
  more: "Plus",
  search: "Rechercher",
  searchBing: "Rechercher sur Bing",
  bookmarks: "Favoris",
  history: "Historique",
  reading: "Liste de lecture",
  downloads: "Téléchargements",
  console: "Journal",
  back: "Retour",
  forward: "Suivant",
  reload: "Actualiser",
  home: "Accueil",
  note: "Note",
  web: "Web",
  noteBrowser: "Navigateur de notes",
  saveMd: "Enregistrer MD",
  download: "Télécharger",
  open: "Ouvrir",
  copy: "Copier",
  save: "Enregistrer",
  tools: "Outils",
  page: "Page",
  view: "Affichage",
  close: "Fermer",
  translateAction: "Traduire",
  qrCode: "QR code",
  copyLink: "Copier le lien",
  copiedLink: "Lien copié",
  loading: "Chargement...",
  searching: "Recherche...",
  moreResults: "Plus de résultats",
  noEntries: "Aucune entrée",
  noDownloadsYet: "Aucun téléchargement",
  noHistoryYet: "Aucun historique",
  noBookmarksYet: "Aucun favori",
  addBookmark: "Ajouter aux favoris",
  removeBookmark: "Retirer le favori",
  mobileVersion: "Version mobile",
  desktopVersion: "Version bureau",
  fullscreen: "Plein écran",
  exitFullscreen: "Quitter le plein écran",
  reader: "Lecteur",
  links: "Liens"
});

const UI_TEXT_DE = commonUi({
  clearCookies: "Website-Cookies löschen",
  cookiesCleared: "Website-Cookies gelöscht",
  uiLanguageDesc: "Folgt standardmäßig der Obsidian-/Systemsprache. Sie können auch eine feste Sprache für dieses Plugin wählen.",
  coreEntry: "Kerneinstieg",
  coreEntryDesc: "Startseite, Suche, Browser-Einstiege und Startverhalten.",
  homePageDesc: "Standardseite, die über die Start-Taste geöffnet wird.",
  searchUrlDesc: "{{query}} ist der Platzhalter für den kodierten Suchtext.",
  noteBrowserCurrentUrl: "Aktuelle Notizbrowser-URL",
  noteBrowserCurrentUrlDesc: "Die URL, die beim Öffnen des notizbasierten Browsers wiederhergestellt wird.",
  openBrowserDesc: "Notizbasierten Browser schnell aus den Einstellungen öffnen.",
  openOnStartup: "Beim Start öffnen",
  openOnStartupDesc: "Notizbasierten Browser nach Bereitstellung des Obsidian-Layouts in der Leseansicht öffnen.",
  interfaceRendering: "Oberfläche und Darstellung",
  interfaceRenderingDesc: "Steuert mobile Werkzeugleiste, NoteDraw-Zauberstab, Leseebene und Seitenzoom.",
  compactMobileToolbar: "Kompakte mobile Werkzeugleiste",
  compactMobileToolbarDesc: "Kleinere Steuerelemente für Telefonbildschirme.",
  showNoteDrawMagicWand: "NoteDraw-Zauberstab anzeigen",
  showNoteDrawMagicWandDesc: "Zeigt die Zauberstab-Schaltfläche in Mobile-Webviewer-Flächen, wenn NoteDraw verfügbar ist.",
  readerHint: "Leser-Hinweis",
  readerHintDesc: "Zeigt Hinweise der Leseebene, wenn der interne Browser notizähnliche Seiten darstellt.",
  liveBrowserFirst: "Live-Browser zuerst",
  liveBrowserFirstDesc: "Zeigt die Live-WebView-Fläche über der notizartigen Leseebene.",
  frontendMode: "Vordergrund-Modus",
  frontendModeDesc: "Standard-Vordergrund: bearbeitbare Notiz oder vollständige Webseite.",
  editableNote: "Bearbeitbare Notiz",
  fullWebPage: "Vollständige Webseite",
  autoSaveWebNotes: "Webnotizen automatisch speichern",
  autoSaveWebNotesDesc: "Bearbeitete Lesetexte und Kritzeleien nur in den Plugin-Daten automatisch speichern. Mit MD speichern eine Markdown-Datei zum Vault hinzufügen.",
  webNoteFolder: "Webnotizen-Ordner",
  webNoteFolderDesc: "Manuelle MD-speichern-Exporte werden hier im Vault gespeichert.",
  pageZoom: "Seitenzoom",
  pageZoomDesc: "Standardzoom für Live-Browser-Flächen.",
  readerFontSize: "Leser-Schriftgröße",
  readerFontSizeDesc: "Schriftgröße der Lese-/Cache-Ebene.",
  desktopView: "Desktop-Ansicht",
  desktopViewDesc: "Verwendet eine breitere Live-Browser-Fläche.",
  userAgent: "User-Agent",
  userAgentDesc: "Wird für interne Abruf-/Such-/Download-Anfragen und die Live-Browser-Fläche verwendet, wo Obsidian Steuerung anbietet.",
  mobile: "Mobil",
  desktop: "Desktop",
  downloadDesc: "Dateien, HTML, MHT und Offline-Seiten speichern.",
  downloadFolder: "Download-Ordner",
  downloadFolderDesc: "Dateien aus Mehr > Download, HTML und MHT.",
  downloadConnections: "Download-Verbindungen",
  downloadConnectionsDesc: "Parallele Byte-Range-Verbindungen, wenn der Server fortsetzbare Downloads unterstützt.",
  browserMode: "Browser-Modi",
  browserModeDesc: "Diese Schalter beeinflussen die interne Darstellung von Browser View und Notizbrowser.",
  nightMode: "Nachtmodus",
  nightModeDesc: "Dunkelt die interne Browser-Hülle und Leser-Flächen ab.",
  eyeProtection: "Augenschutz",
  eyeProtectionDesc: "Verwendet einen weicheren Leseton.",
  adBlock: "Werbeblocker",
  adBlockDesc: "Entfernt gängige Werbecontainer, wo die Seite zugänglich ist.",
  markAds: "Werbung markieren",
  markAdsDesc: "Markiert wahrscheinliche Werbecontainer, wo die Seite zugänglich ist.",
  incognito: "Inkognito",
  incognitoDesc: "Stoppt das Schreiben von Verlauf und Leser-Cache.",
  disableJavaScript: "JavaScript deaktivieren",
  disableJavaScriptDesc: "Lädt Live-Seiten ohne allow-scripts in der Sandbox neu.",
  rotateScreen: "Bildschirm drehen",
  rotateScreenDesc: "Verwendet eine breitere querformatige Browser-Fläche.",
  dataImportExport: "Datenimport und -export",
  dataImportExportDesc: "Lesezeichen, Leseliste, Verlauf, Downloads, Skriptregeln, Webnotizen und gängige Einstellungen.",
  universalExport: "Universeller Export",
  universalExportDesc: "Ein tragbares Mobile-Webviewer-JSON-Paket im Download-Ordner speichern.",
  exportJson: "JSON exportieren",
  copyJson: "JSON kopieren",
  universalImport: "Universeller Import",
  universalImportDesc: "Mobile-Webviewer-JSON, gängiges Lesezeichen-HTML oder einfache URL-Zeilen aus der Zwischenablage importieren. Vorhandene Daten werden zusammengeführt.",
  importClipboard: "Aus Zwischenablage importieren",
  translation: "Übersetzung",
  translationDesc: "Folgt standardmäßig der Obsidian-Sprache oder wählt eine feste Zielsprache.",
  defaultTranslationLanguage: "Standard-Übersetzungssprache",
  defaultTranslationLanguageDesc: "Wird in Mehr > Übersetzen und in der Sprachauswahl verwendet. „Obsidian-Sprache folgen“ koppelt die Übersetzung an die aktuelle Obsidian-Oberflächensprache.",
  scriptsReader: "Skripte und Leseebene",
  scriptsReaderDesc: "CSS und JavaScript der Leseebene sowie URL-basierte Skriptregeln.",
  readerUserScripts: "Leser-Benutzerskripte",
  readerUserScriptsDesc: "Eigene CSS- und JavaScript-Regeln auf die interne Leseebene anwenden.",
  readerCss: "Leser-CSS",
  readerCssDesc: "CSS, das in gerenderte Lese-/Cache-Seiten injiziert wird.",
  readerJavascript: "Leser-JavaScript",
  readerJavascriptDesc: "Läuft mit container, page und hostName.",
  userScriptRules: "Benutzerskript-Regeln",
  rulesCount: "Regeln ({count})",
  rulesDesc: "URL-basierte CSS- und JavaScript-Regeln für die interne Leseebene.",
  addRule: "Regel hinzufügen",
  ruleName: "Regelname",
  delete: "Löschen",
  match: "Übereinstimmung",
  matchDesc: "Unterstützt Teilstring oder Platzhalter, z. B. *://*.example.com/*",
  css: "CSS",
  cssDesc: "Wird in passende Leser-Seiten injiziert.",
  javascript: "JavaScript",
  javascriptDesc: "Läuft mit container, page, hostName und rule.",
  autofill: "Auto-Ausfüllen",
  autofillDesc: "Verwendet in Mehr > Seite ausfüllen; füllt nur zugängliche leere Felder.",
  autofillName: "Auto-Ausfüllen Name",
  autofillEmail: "Auto-Ausfüllen E-Mail",
  autofillPhone: "Auto-Ausfüllen Telefon",
  autofillAddress: "Auto-Ausfüllen Adresse",
  autofillFieldDesc: "Verwendet in Mehr > Seite ausfüllen.",
  dataMaintenance: "Datenpflege",
  dataMaintenanceDesc: "Browserverlauf, Leser-Cache, Downloads und Konsolenprotokolle löschen.",
  clearHistory: "Verlauf löschen",
  clearReaderCache: "Leser-Cache löschen",
  clearDownloads: "Downloads löschen",
  readingList: "Leseliste",
  clearConsole: "Konsole löschen",
  clearBrowsingData: "Browserdaten löschen",
  clearBrowsingDataDesc: "Löscht Verlauf, Leser-Cache und Konsoleneinträge. Lesezeichen, Leseliste und Dateien bleiben erhalten.",
  exportBookmarkNote: "Lesezeichen-Notiz exportieren",
  exportBookmarkNoteDesc: "Erstellt eine Markdown-Notiz mit den aktuellen Lesezeichen.",
  clear: "Leeren",
  create: "Erstellen",
  savedEntries: "{count} gespeicherte Einträge.",
  cachedPages: "{count} zwischengespeicherte Seiten.",
  downloadRecords: "{count} gespeicherte Download-Einträge. Dateien werden nicht entfernt.",
  savedPages: "{count} gespeicherte Seiten.",
  consoleEntries: "{count} Konsoleneinträge.",
  supportCodes: "Unterstützungs-Codes",
  supportCodesDesc: "Wenn dieses Plugin hilft, scannen Sie einen Code, um die Weiterpflege zu unterstützen.",
  searchOrEnterUrl: "Suchen oder URL eingeben",
  go: "Los",
  closeMore: "Mehr schließen",
  ready: "Bereit",
  closePanel: "Panel schließen",
  bookmark: "Lesezeichen",
  saveLink: "Link speichern",
  noReadingListYet: "Noch keine Leseliste",
  noConsoleLogs: "Keine Konsolenprotokolle",
  searchingBing: "Bing wird durchsucht...",
  resultsCount: "{count} Ergebnis(se)",
  loadFailedRetry: "Laden fehlgeschlagen, erneut versuchen",
  nativeLightHome: "Native schlanke Startseite",
  readingStatus: "Wird gelesen...",
  pageTools: "Seitenwerkzeuge",
  doodle: "Kritzelei",
  closeDoodle: "Kritzelei schließen",
  editableWebNote: "Bearbeitbare Webnotiz",
  autoSavedPlugin: "Automatisch im Plugin gespeichert",
  saving: "Speichern...",
  savedPlugin: "Im Plugin gespeichert",
  savedMarkdown: "Gespeichert unter {path}",
  webNoteSaved: "Webnotiz in Plugin-Daten gespeichert",
  savedTo: "Gespeichert unter {path}",
  bookmarkAdded: "Lesezeichen hinzugefügt",
  bookmarkRemoved: "Lesezeichen entfernt",
  noPreviousPage: "Keine vorherige Seite",
  noNextPage: "Keine nächste Seite",
  internalBrowserTab: "Interner Browser-Tab",
  refresh: "Aktualisieren",
  openCancip: "Cancip öffnen",
  all: "Alle",
  completed: "Abgeschlossen",
  failed: "Fehlgeschlagen",
  today: "Heute",
  latest: "Neueste",
  downloadState: "{status} · {progress}%",
  openFile: "Öffnen",
  copyPath: "Pfad kopieren",
  location: "Ort",
  source: "Quelle",
  cancipDetected: "Cancip AI erkannt",
  cancipNotEnabled: "Cancip AI ist nicht aktiviert",
  cancipDetectedDesc: "Version {version}; AI-Panel von hier öffnen.",
  cancipNotEnabledDesc: "Nach Installation oder Aktivierung von Cancip kann Mobile Webviewer den aktuellen Webkontext als KI-Einstieg bereitstellen.",
  copyCurrentContext: "Aktuellen Webkontext kopieren",
  sendCurrentToCancip: "Aktuelle Seite an Cancip senden",
  sentCurrentToCancip: "Aktuelle Seite zu Cancip hinzugefügt",
  cancipContextPrompt: "Nutzen Sie diesen Webkontext zum Analysieren, Ordnen, Exzerpieren oder Notizerstellen.",
  copiedCancipContext: "Cancip-Kontext kopiert",
  downloadComplete: "Download abgeschlossen: {path}",
  newTab: "Neuer Tab",
  openLink: "Link öffnen",
  openInNewTab: "In neuem Tab öffnen",
  downloadLink: "Link herunterladen",
  downloadSavedTo: "Downloads gespeichert unter: {folder}",
  tabs: "Tabs",
  downloadPage: "Downloads ({count})",
  bookmarksCount: "Lesezeichen ({count})",
  historyCount: "Verlauf ({count})",
  readingCount: "Leseliste ({count})",
  consoleCount: "Protokolle ({count})",
  downloadsCount: "Downloads ({count})",
  newObTab: "Neuer OB-Tab",
  openNoteWeb: "Note Web öffnen",
  openInBrowser: "Im Browser öffnen",
  share: "Teilen",
  browserStatus: "Browser-Status",
  zoomIn: "Vergrößern {value}%",
  zoomOut: "Verkleinern",
  dayMode: "Tagmodus",
  closeEyeProtection: "Augenschutz aus",
  closeAdBlock: "Werbeblocker aus",
  adBlocking: "Werbeblocker",
  unmarkAds: "Werbemarkierung aufheben",
  closeIncognito: "Inkognito beenden",
  enableJs: "JS aktivieren",
  disableJs: "JS deaktivieren",
  closeLandscape: "Querformat beenden",
  landscape: "Querformat",
  fontSize: "Schriftgröße {value}%",
  downloadFile: "Datei herunterladen",
  saveHtml: "HTML speichern",
  saveMht: "MHT speichern",
  offlinePage: "Offline-Seite",
  desktopShortcut: "Desktop-Verknüpfung",
  addReadingList: "Zur Leseliste hinzufügen",
  autofillPage: "Seite ausfüllen",
  scriptsCount: "Skripte ({count})",
  mediaSniff: "Medien-Sniffing",
  pageAssets: "Seitenressourcen",
  copySource: "Quelle kopieren",
  viewSource: "Quelle anzeigen",
  readAloud: "Vorlesen",
  report: "Bericht",
  copyLogs: "Protokolle kopieren",
  clearCache: "Cache leeren ({count})",
  siteSettings: "Website-Einstellungen",
  toolStatus: "Werkzeugstatus",
  clearBrowsingDataAction: "Browserdaten löschen",
  runningAction: "Läuft: {label}",
  completedAction: "Abgeschlossen: {label}",
  failedAction: "{label} fehlgeschlagen: {message}",
  downloadFinished: "Download abgeschlossen: {path}",
  saved: "Gespeichert: {path}",
  addedReadingList: "Zur Leseliste hinzugefügt",
  mediaCopied: "Medien kopiert: {count}",
  resourcesCopied: "Ressourcen kopiert",
  sourceCopied: "Quelle kopiert",
  consoleCopied: "Konsole kopiert",
  cacheCleared: "Cache geleert",
  browsingDataCleared: "Browserdaten gelöscht",
  translatePageTo: "Seite übersetzen nach...",
  newObsidianTab: "Neuer Obsidian-Tab",
  address: "Adresse",
  webResultsTab: "Web",
  imageResultsTab: "Bilder",
  videoResultsTab: "Videos",
  academicTab: "Wissenschaft",
  dictionaryTab: "Wörterbuch",
  mapsTab: "Karten",
  moreTab: "Mehr",
  aboutResults: "Etwa {count} Ergebnisse",
  learnMoreAbout: "Mehr über {query} erfahren",
  webNotePlaceholder: "Webnotiz",
  fallbackEditableNote: "Seitenladen eingeschränkt; eine bearbeitbare Notizebene bleibt erhalten.",
  loadingValue: "Lädt: {value}",
  yes: "Ja",
  no: "Nein",
  downloadDirectory: "Download-Verzeichnis: {folder}",
  cancipAi: "Cancip AI",
  currentOpen: "Aktuelle öffnen",
  readerExtracting: "Seitenzusammenfassung wird extrahiert...",
  insertedLink: "Link eingefügt",
  copiedMarkdownLink: "Markdown-Link kopiert",
  noteDrawDisabled: "NoteDraw-Plugin ist nicht aktiviert.",
  readerNoteNotReady: "Leser-Notiz ist noch nicht bereit",
  noWebNoteToExport: "Keine Webnotiz zum Exportieren",
  jsonCopied: "Mobile-Webviewer-JSON kopiert",
  clipboardEmpty: "Zwischenablage ist leer",
  fileMissingPathCopied: "Datei im Vault nicht gefunden; Pfad kopiert",
  htmlSaveFailed: "HTML-Speichern fehlgeschlagen",
  mhtSaveFailed: "MHT-Speichern fehlgeschlagen",
  shareTextCopied: "Freigabetext kopiert",
  downloadFailed: "Download fehlgeschlagen",
  cancipDisabled: "Cancip-Plugin ist nicht aktiviert",
  noWebLinkFound: "Kein Weblink gefunden",
  bookmarkNoteCreated: "Lesezeichen-Notiz erstellt",
  emptyConsoleDesc: "Noch keine Protokolle. Suche, Downloads, Speichervorgänge und Skripte erscheinen hier.",
  pageSource: "Seitenquelle",
  copyReport: "Bericht kopieren",
  reportUrl: "Berichts-URL",
  reportCopied: "Bericht kopiert",
  urlCopied: "URL kopiert",
  translatePage: "Seite übersetzen",
  noSavedPages: "Keine gespeicherten Seiten",
  noResourcesFound: "Keine Ressourcen gefunden",
  disabled: "Deaktiviert",
  noMatchingScripts: "Keine passenden Skripte",
  findInPage: "Auf Seite suchen",
  previous: "Zurück",
  next: "Weiter",
  pageLoadLimited: "Seitenladen eingeschränkt; eine bearbeitbare Notizebene bleibt erhalten.",
  systemBrowser: "Im Systembrowser öffnen",
  proxyModeActive: "Seite lehnt Einbettung ab — echte Seite über integrierten Proxy geladen",
  postFormUnsupported: "POST-Formularversand wird im Proxy-Modus nicht unterstützt",
  uiLanguage: "Oberflächensprache",
  followObsidian: "Obsidian-Sprache folgen",
  homePage: "Startseite",
  searchUrl: "Such-URL",
  openBrowser: "Browser öffnen",
  settings: "Einstellungen",
  more: "Mehr",
  search: "Suchen",
  searchBing: "Mit Bing suchen",
  bookmarks: "Lesezeichen",
  history: "Verlauf",
  reading: "Leseliste",
  downloads: "Downloads",
  console: "Protokoll",
  back: "Zurück",
  forward: "Vor",
  reload: "Neu laden",
  home: "Start",
  note: "Notiz",
  web: "Web",
  noteBrowser: "Notizbrowser",
  saveMd: "MD speichern",
  download: "Download",
  open: "Öffnen",
  copy: "Kopieren",
  save: "Speichern",
  tools: "Werkzeuge",
  page: "Seite",
  view: "Ansicht",
  close: "Schließen",
  translateAction: "Übersetzen",
  qrCode: "QR-Code",
  copyLink: "Link kopieren",
  copiedLink: "Link kopiert",
  loading: "Laden...",
  searching: "Suchen...",
  moreResults: "Weitere Ergebnisse",
  noEntries: "Keine Einträge",
  noDownloadsYet: "Keine Downloads",
  noHistoryYet: "Kein Verlauf",
  noBookmarksYet: "Keine Lesezeichen",
  addBookmark: "Lesezeichen hinzufügen",
  removeBookmark: "Lesezeichen entfernen",
  mobileVersion: "Mobile Version",
  desktopVersion: "Desktop-Version",
  fullscreen: "Vollbild",
  exitFullscreen: "Vollbild beenden",
  reader: "Leser",
  links: "Links"
});

const UI_TEXT_ES = commonUi({
  clearCookies: "Borrar cookies del sitio",
  cookiesCleared: "Cookies del sitio borradas",
  uiLanguageDesc: "Sigue por defecto el idioma de Obsidian/sistema. También puedes fijar un idioma para el plugin.",
  coreEntry: "Entrada principal",
  coreEntryDesc: "Página de inicio, búsqueda, entradas del navegador y comportamiento al arrancar.",
  homePageDesc: "Página predeterminada que abre el botón de inicio.",
  searchUrlDesc: "Usa {{query}} como marcador del texto de búsqueda codificado.",
  noteBrowserCurrentUrl: "URL actual del navegador de notas",
  noteBrowserCurrentUrlDesc: "La URL que se restaura al abrir el navegador basado en notas.",
  openBrowserDesc: "Abrir rápidamente el navegador basado en notas desde los ajustes.",
  openOnStartup: "Abrir al iniciar",
  openOnStartupDesc: "Abre el navegador de notas en vista de lectura cuando el diseño de Obsidian esté listo.",
  interfaceRendering: "Interfaz y renderizado",
  interfaceRenderingDesc: "Controla la barra móvil, la varita de NoteDraw, la capa de lectura y la escala de página.",
  compactMobileToolbar: "Barra móvil compacta",
  compactMobileToolbarDesc: "Usa controles más pequeños para pantallas de teléfono.",
  showNoteDrawMagicWand: "Mostrar varita de NoteDraw",
  showNoteDrawMagicWandDesc: "Muestra el botón de varita en las superficies de Mobile Webviewer cuando NoteDraw esté disponible.",
  readerHint: "Aviso del lector",
  readerHintDesc: "Muestra avisos de la capa de lectura cuando el navegador interno renderiza páginas tipo nota.",
  liveBrowserFirst: "Navegador vivo primero",
  liveBrowserFirstDesc: "Muestra la superficie WebView viva sobre la capa de lectura estilo nota.",
  frontendMode: "Modo de primer plano",
  frontendModeDesc: "Primer plano predeterminado: nota editable o página web completa.",
  editableNote: "Nota editable",
  fullWebPage: "Página web completa",
  autoSaveWebNotes: "Autoguardar notas web",
  autoSaveWebNotesDesc: "Guarda automáticamente el texto del lector y los garabatos solo en los datos del plugin. Usa Guardar MD para añadir un archivo Markdown a la bóveda.",
  webNoteFolder: "Carpeta de notas web",
  webNoteFolderDesc: "Las exportaciones manuales de Guardar MD se guardan aquí dentro de la bóveda.",
  pageZoom: "Zoom de página",
  pageZoomDesc: "Zoom predeterminado para las superficies del navegador vivo.",
  readerFontSize: "Tamaño de letra del lector",
  readerFontSizeDesc: "Tamaño de letra de la capa de lectura/caché.",
  desktopView: "Vista de escritorio",
  desktopViewDesc: "Usa una superficie de navegador vivo más amplia.",
  userAgent: "User agent",
  userAgentDesc: "Usado por las peticiones internas de obtención/búsqueda/descarga y por la superficie del navegador vivo donde Obsidian expone control.",
  mobile: "Móvil",
  desktop: "Escritorio",
  downloadDesc: "Guarda archivos, HTML, MHT y páginas sin conexión.",
  downloadFolder: "Carpeta de descargas",
  downloadFolderDesc: "Archivos guardados por Más > Descargar, HTML y MHT.",
  downloadConnections: "Conexiones de descarga",
  downloadConnectionsDesc: "Conexiones paralelas por rangos de bytes cuando el servidor admite descargas reanudables.",
  browserMode: "Modos del navegador",
  browserModeDesc: "Estos interruptores afectan al renderizado interno de Browser View y el navegador de notas.",
  nightMode: "Modo nocturno",
  nightModeDesc: "Oscurece el armazón del navegador interno y las superficies del lector.",
  eyeProtection: "Protección ocular",
  eyeProtectionDesc: "Aplica un tono de lectura más suave.",
  adBlock: "Bloqueo de anuncios",
  adBlockDesc: "Elimina contenedores de anuncios comunes donde la página es accesible.",
  markAds: "Marcar anuncios",
  markAdsDesc: "Marca contenedores probablemente publicitarios donde la página es accesible.",
  incognito: "Incógnito",
  incognitoDesc: "Detiene la escritura de historial y caché del lector.",
  disableJavaScript: "Desactivar JavaScript",
  disableJavaScriptDesc: "Recarga las páginas vivas sin allow-scripts en el sandbox.",
  rotateScreen: "Girar pantalla",
  rotateScreenDesc: "Usa una superficie de navegador más amplia, tipo horizontal.",
  dataImportExport: "Importar y exportar datos",
  dataImportExportDesc: "Marcadores, lista de lectura, historial, descargas, reglas de scripts, notas web y ajustes comunes.",
  universalExport: "Exportación universal",
  universalExportDesc: "Guarda un paquete JSON portable de Mobile Webviewer en la carpeta de descargas.",
  exportJson: "Exportar JSON",
  copyJson: "Copiar JSON",
  universalImport: "Importación universal",
  universalImportDesc: "Importa desde el portapapeles JSON de Mobile Webviewer, HTML de marcadores común o líneas de URL. Los datos existantes se fusionan.",
  importClipboard: "Importar del portapapeles",
  translation: "Traducción",
  translationDesc: "Sigue por defecto el idioma de Obsidian, o elige un idioma destino fijo.",
  defaultTranslationLanguage: "Idioma de traducción predeterminado",
  defaultTranslationLanguageDesc: "Usado por Más > Traducir y el selector de idioma. Seguir Obsidian vincula la traducción al idioma de interfaz actual de Obsidian.",
  scriptsReader: "Scripts y capa de lectura",
  scriptsReaderDesc: "CSS y JavaScript de la capa de lectura y reglas de scripts por URL.",
  readerUserScripts: "Scripts de usuario del lector",
  readerUserScriptsDesc: "Aplica CSS y JavaScript personalizados a la capa de lectura interna.",
  readerCss: "CSS del lector",
  readerCssDesc: "CSS inyectado en las páginas de lectura/caché renderizadas.",
  readerJavascript: "JavaScript del lector",
  readerJavascriptDesc: "Se ejecuta con container, page y hostName.",
  userScriptRules: "Reglas de scripts de usuario",
  rulesCount: "Reglas ({count})",
  rulesDesc: "CSS y JavaScript por coincidencia de URL para la capa de lectura interna.",
  addRule: "Añadir regla",
  ruleName: "Nombre de la regla",
  delete: "Eliminar",
  match: "Coincidencia",
  matchDesc: "Admite subcadena o comodín, por ejemplo *://*.example.com/*",
  css: "CSS",
  cssDesc: "Se inyecta en las páginas de lectura coincidentes.",
  javascript: "JavaScript",
  javascriptDesc: "Se ejecuta con container, page, hostName y rule.",
  autofill: "Autocompletar",
  autofillDesc: "Usado por Más > Autocompletar página; rellena solo campos vacíos accesibles.",
  autofillName: "Nombre de autocompletado",
  autofillEmail: "Correo de autocompletado",
  autofillPhone: "Teléfono de autocompletado",
  autofillAddress: "Dirección de autocompletado",
  autofillFieldDesc: "Usado por Más > Autocompletar página.",
  dataMaintenance: "Mantenimiento de datos",
  dataMaintenanceDesc: "Borra historial, caché del lector, descargas y registros de consola.",
  clearHistory: "Borrar historial",
  clearReaderCache: "Borrar caché del lector",
  clearDownloads: "Borrar descargas",
  readingList: "Lista de lectura",
  clearConsole: "Borrar consola",
  clearBrowsingData: "Borrar datos de navegación",
  clearBrowsingDataDesc: "Borra historial, caché del lector y entradas de consola. Los marcadores, la lista de lectura y los archivos se conservan.",
  exportBookmarkNote: "Exportar nota de marcadores",
  exportBookmarkNoteDesc: "Crea una nota Markdown con los marcadores actuales.",
  clear: "Limpiar",
  create: "Crear",
  savedEntries: "{count} entradas guardadas.",
  cachedPages: "{count} páginas en caché.",
  downloadRecords: "{count} registros de descarga guardados. Los archivos no se eliminan.",
  savedPages: "{count} páginas guardadas.",
  consoleEntries: "{count} entradas de consola.",
  supportCodes: "Códigos de apoyo",
  supportCodesDesc: "Si este plugin te ayuda, escanea un código para apoyar su mantenimiento continuo.",
  searchOrEnterUrl: "Buscar o introducir URL",
  go: "Ir",
  closeMore: "Cerrar Más",
  ready: "Listo",
  closePanel: "Cerrar panel",
  bookmark: "Marcador",
  saveLink: "Guardar enlace",
  noReadingListYet: "Aún no hay lista de lectura",
  noConsoleLogs: "Sin registros de consola",
  searchingBing: "Buscando en Bing...",
  resultsCount: "{count} resultado(s)",
  loadFailedRetry: "Fallo al cargar, reintentar",
  nativeLightHome: "Inicio nativo ligero",
  readingStatus: "Leyendo...",
  pageTools: "Herramientas de página",
  doodle: "Garabato",
  closeDoodle: "Cerrar garabato",
  editableWebNote: "Nota web editable",
  autoSavedPlugin: "Autoguardado en el plugin",
  saving: "Guardando...",
  savedPlugin: "Guardado en el plugin",
  savedMarkdown: "Guardado en {path}",
  webNoteSaved: "Nota web guardada en los datos del plugin",
  savedTo: "Guardado en {path}",
  bookmarkAdded: "Marcador añadido",
  bookmarkRemoved: "Marcador eliminado",
  noPreviousPage: "No hay página anterior",
  noNextPage: "No hay página siguiente",
  internalBrowserTab: "Pestaña del navegador interno",
  refresh: "Actualizar",
  openCancip: "Abrir Cancip",
  all: "Todo",
  completed: "Completado",
  failed: "Fallido",
  today: "Hoy",
  latest: "Más recientes",
  downloadState: "{status} · {progress}%",
  openFile: "Abrir",
  copyPath: "Copiar ruta",
  location: "Ubicación",
  source: "Fuente",
  cancipDetected: "Cancip AI detectado",
  cancipNotEnabled: "Cancip AI no está activado",
  cancipDetectedDesc: "Versión {version}; abre el panel de IA desde aquí.",
  cancipNotEnabledDesc: "Tras instalar o activar Cancip, Mobile Webviewer puede ofrecer el contexto web actual como entrada de IA.",
  copyCurrentContext: "Copiar el contexto web actual",
  sendCurrentToCancip: "Enviar la página actual a Cancip",
  sentCurrentToCancip: "Página actual añadida a Cancip",
  cancipContextPrompt: "Usa este contexto web para analizar, organizar, extraer citas o generar notas.",
  copiedCancipContext: "Contexto de Cancip copiado",
  downloadComplete: "Descarga completada: {path}",
  newTab: "Nueva pestaña",
  openLink: "Abrir enlace",
  openInNewTab: "Abrir en nueva pestaña",
  downloadLink: "Descargar enlace",
  downloadSavedTo: "Descargas guardadas en: {folder}",
  tabs: "Pestañas",
  downloadPage: "Descargas ({count})",
  bookmarksCount: "Marcadores ({count})",
  historyCount: "Historial ({count})",
  readingCount: "Lectura ({count})",
  consoleCount: "Registros ({count})",
  downloadsCount: "Descargas ({count})",
  newObTab: "Nueva pestaña OB",
  openNoteWeb: "Abrir Note Web",
  openInBrowser: "Abrir en el navegador",
  share: "Compartir",
  browserStatus: "Estado del navegador",
  zoomIn: "Ampliar {value}%",
  zoomOut: "Reducir",
  dayMode: "Modo día",
  closeEyeProtection: "Desactivar protección ocular",
  closeAdBlock: "Desactivar bloqueo de anuncios",
  adBlocking: "Bloqueo de anuncios",
  unmarkAds: "Quitar marca de anuncios",
  closeIncognito: "Salir de incógnito",
  enableJs: "Activar JS",
  disableJs: "Desactivar JS",
  closeLandscape: "Salir de horizontal",
  landscape: "Horizontal",
  fontSize: "Tamaño de letra {value}%",
  downloadFile: "Descargar archivo",
  saveHtml: "Guardar HTML",
  saveMht: "Guardar MHT",
  offlinePage: "Página sin conexión",
  desktopShortcut: "Acceso directo de escritorio",
  addReadingList: "Añadir a lista de lectura",
  autofillPage: "Autocompletar página",
  scriptsCount: "Scripts ({count})",
  mediaSniff: "Detección de medios",
  pageAssets: "Recursos de página",
  copySource: "Copiar fuente",
  viewSource: "Ver fuente",
  readAloud: "Leer en voz alta",
  report: "Informe",
  copyLogs: "Copiar registros",
  clearCache: "Vaciar caché ({count})",
  siteSettings: "Ajustes del sitio",
  toolStatus: "Estado de herramientas",
  clearBrowsingDataAction: "Borrar datos de navegación",
  runningAction: "Ejecutando: {label}",
  completedAction: "Completado: {label}",
  failedAction: "{label} falló: {message}",
  downloadFinished: "Descarga terminada: {path}",
  saved: "Guardado: {path}",
  addedReadingList: "Añadido a la lista de lectura",
  mediaCopied: "Medios copiados: {count}",
  resourcesCopied: "Recursos copiados",
  sourceCopied: "Fuente copiada",
  consoleCopied: "Consola copiada",
  cacheCleared: "Caché vaciada",
  browsingDataCleared: "Datos de navegación borrados",
  translatePageTo: "Traducir página a...",
  newObsidianTab: "Nueva pestaña de Obsidian",
  address: "Dirección",
  webResultsTab: "Web",
  imageResultsTab: "Imágenes",
  videoResultsTab: "Vídeos",
  academicTab: "Académico",
  dictionaryTab: "Diccionario",
  mapsTab: "Mapas",
  moreTab: "Más",
  aboutResults: "Unos {count} resultados",
  learnMoreAbout: "Saber más sobre {query}",
  webNotePlaceholder: "Nota web",
  fallbackEditableNote: "Carga de página limitada; se mantiene una capa de nota editable.",
  loadingValue: "Cargando: {value}",
  yes: "Sí",
  no: "No",
  downloadDirectory: "Directorio de descargas: {folder}",
  cancipAi: "Cancip AI",
  currentOpen: "Abrir actual",
  readerExtracting: "Extrayendo resumen de página...",
  insertedLink: "Enlace insertado",
  copiedMarkdownLink: "Enlace Markdown copiado",
  noteDrawDisabled: "El plugin NoteDraw no está activado.",
  readerNoteNotReady: "La nota del lector aún no está lista",
  noWebNoteToExport: "No hay nota web que exportar",
  jsonCopied: "JSON de Mobile Webviewer copiado",
  clipboardEmpty: "El portapapeles está vacío",
  fileMissingPathCopied: "Archivo no encontrado en la bóveda; ruta copiada",
  htmlSaveFailed: "Fallo al guardar HTML",
  mhtSaveFailed: "Fallo al guardar MHT",
  shareTextCopied: "Texto de compartir copiado",
  downloadFailed: "Descarga fallida",
  cancipDisabled: "El plugin Cancip no está activado",
  noWebLinkFound: "No se encontró enlace web",
  bookmarkNoteCreated: "Nota de marcadores creada",
  emptyConsoleDesc: "Aún no hay registros. Las búsquedas, descargas, guardados y scripts aparecerán aquí.",
  pageSource: "Código fuente de la página",
  copyReport: "Copiar informe",
  reportUrl: "URL del informe",
  reportCopied: "Informe copiado",
  urlCopied: "URL copiada",
  translatePage: "Traducir página",
  noSavedPages: "No hay páginas guardadas",
  noResourcesFound: "No se encontraron recursos",
  disabled: "Desactivado",
  noMatchingScripts: "Sin scripts coincidentes",
  findInPage: "Buscar en la página",
  previous: "Anterior",
  next: "Siguiente",
  pageLoadLimited: "Carga de página limitada; se mantiene una capa de nota editable.",
  systemBrowser: "Abrir en el navegador del sistema",
  proxyModeActive: "El sitio rechaza la inserción — página real cargada vía proxy integrado",
  postFormUnsupported: "El envío de formularios POST no está soportado en modo proxy",
  uiLanguage: "Idioma de interfaz",
  followObsidian: "Seguir idioma de Obsidian",
  homePage: "Página inicial",
  searchUrl: "URL de búsqueda",
  openBrowser: "Abrir navegador",
  settings: "Ajustes",
  more: "Más",
  search: "Buscar",
  searchBing: "Buscar en Bing",
  bookmarks: "Marcadores",
  history: "Historial",
  reading: "Lista de lectura",
  downloads: "Descargas",
  console: "Registro",
  back: "Atrás",
  forward: "Adelante",
  reload: "Recargar",
  home: "Inicio",
  note: "Nota",
  web: "Web",
  noteBrowser: "Navegador de notas",
  saveMd: "Guardar MD",
  download: "Descargar",
  open: "Abrir",
  copy: "Copiar",
  save: "Guardar",
  tools: "Herramientas",
  page: "Página",
  view: "Vista",
  close: "Cerrar",
  translateAction: "Traducir",
  qrCode: "Código QR",
  copyLink: "Copiar enlace",
  copiedLink: "Enlace copiado",
  loading: "Cargando...",
  searching: "Buscando...",
  moreResults: "Más resultados",
  noEntries: "Sin entradas",
  noDownloadsYet: "Sin descargas",
  noHistoryYet: "Sin historial",
  noBookmarksYet: "Sin marcadores",
  addBookmark: "Añadir marcador",
  removeBookmark: "Quitar marcador",
  mobileVersion: "Versión móvil",
  desktopVersion: "Versión de escritorio",
  fullscreen: "Pantalla completa",
  exitFullscreen: "Salir de pantalla completa",
  reader: "Lector",
  links: "Enlaces"
});

const UI_TEXT_PT = commonUi({
  ...UI_TEXT_ES,
  uiLanguage: "Idioma da interface",
  followObsidian: "Seguir idioma do Obsidian",
  homePage: "Página inicial",
  searchUrl: "URL de pesquisa",
  openBrowser: "Abrir navegador",
  settings: "Configurações",
  more: "Mais",
  search: "Pesquisar",
  searchBing: "Pesquisar no Bing",
  bookmarks: "Favoritos",
  history: "Histórico",
  reading: "Lista de leitura",
  downloads: "Downloads",
  console: "Registro",
  back: "Voltar",
  forward: "Avançar",
  reload: "Recarregar",
  open: "Abrir",
  copy: "Copiar",
  save: "Salvar",
  tools: "Ferramentas",
  close: "Fechar",
  translateAction: "Traduzir",
  copyLink: "Copiar link",
  copiedLink: "Link copiado",
  loading: "Carregando...",
  searching: "Pesquisando...",
  moreResults: "Mais resultados",
  noEntries: "Sem entradas",
  addBookmark: "Adicionar favorito",
  removeBookmark: "Remover favorito"
});

const UI_TEXT_IT = commonUi({
  ...UI_TEXT_ES,
  uiLanguage: "Lingua interfaccia",
  followObsidian: "Segui la lingua di Obsidian",
  homePage: "Pagina iniziale",
  searchUrl: "URL di ricerca",
  openBrowser: "Apri browser",
  settings: "Impostazioni",
  more: "Altro",
  search: "Cerca",
  searchBing: "Cerca con Bing",
  bookmarks: "Segnalibri",
  history: "Cronologia",
  reading: "Elenco lettura",
  downloads: "Download",
  console: "Registro",
  back: "Indietro",
  forward: "Avanti",
  reload: "Ricarica",
  open: "Apri",
  copy: "Copia",
  save: "Salva",
  tools: "Strumenti",
  close: "Chiudi",
  translateAction: "Traduci",
  copyLink: "Copia link",
  copiedLink: "Link copiato",
  loading: "Caricamento...",
  searching: "Ricerca...",
  moreResults: "Altri risultati",
  noEntries: "Nessuna voce",
  addBookmark: "Aggiungi segnalibro",
  removeBookmark: "Rimuovi segnalibro"
});

const UI_TEXT_HI = commonUi({
  clearCookies: "साइट कुकीज़ मिटाएँ",
  cookiesCleared: "साइट कुकीज़ मिटा दी गईं",
  uiLanguageDesc: "डिफ़ॉल्ट रूप से Obsidian/सिस्टम भाषा का पालन करती है। आप प्लगइन के लिए निश्चित भाषा भी चुन सकते हैं।",
  coreEntry: "मुख्य प्रवेश",
  coreEntryDesc: "होम पेज, खोज, ब्राउज़र प्रवेश और स्टार्टअप व्यवहार।",
  homePageDesc: "होम बटन द्वारा खोला जाने वाला डिफ़ॉल्ट पेज।",
  searchUrlDesc: "एनकोड किए गए खोज पाठ के लिए {{query}} प्लेसहोल्डर के रूप में उपयोग करें।",
  noteBrowserCurrentUrl: "नोट ब्राउज़र का वर्तमान URL",
  noteBrowserCurrentUrlDesc: "नोट-आधारित ब्राउज़र खोलने पर पुनर्स्थापित होने वाला URL।",
  openBrowserDesc: "सेटिंग्स से नोट-आधारित ब्राउज़र शीघ्र खोलें।",
  openOnStartup: "स्टार्टअप पर खोलें",
  openOnStartupDesc: "Obsidian लेआउट तैयार होने के बाद नोट ब्राउज़र को रीडिंग व्यू में खोलें।",
  interfaceRendering: "इंटरफेस और रेंडरिंग",
  interfaceRenderingDesc: "मोबाइल टूलबार, NoteDraw जादू की छड़ी, रीडर लेयर और पेज स्केल नियंत्रित करें।",
  compactMobileToolbar: "कॉम्पैक्ट मोबाइल टूलबार",
  compactMobileToolbarDesc: "फ़ोन स्क्रीन के लिए छोटे नियंत्रणों का उपयोग करें।",
  showNoteDrawMagicWand: "NoteDraw जादू की छड़ी दिखाएँ",
  showNoteDrawMagicWandDesc: "NoteDraw उपलब्ध होने पर Mobile Webviewer सतहों में छड़ी बटन दिखाएँ।",
  readerHint: "रीडर संकेत",
  readerHintDesc: "आंतरिक ब्राउज़र नोट-जैसे पेज दिखाते समय रीडर लेयर संकेत दिखाएँ।",
  liveBrowserFirst: "लाइव ब्राउज़र पहले",
  liveBrowserFirstDesc: "नोट-शैली रीडर लेयर के ऊपर लाइव WebView सतह दिखाएँ।",
  frontendMode: "फ्रंटएंड मोड",
  frontendModeDesc: "डिफ़ॉल्ट अग्रभाग: संपादन योग्य नोट या पूर्ण वेब पेज।",
  editableNote: "संपादन योग्य नोट",
  fullWebPage: "पूर्ण वेब पेज",
  autoSaveWebNotes: "वेब नोट्स ऑटो-सेव",
  autoSaveWebNotesDesc: "संपादित रीडर पाठ और डूडल केवल प्लगइन डेटा में ऑटो-सेव करें। वॉल्ट में Markdown फ़ाइल जोड़ने के लिए Save MD का उपयोग करें।",
  webNoteFolder: "वेब नोट फ़ोल्डर",
  webNoteFolderDesc: "मैन्युअल Save MD निर्यात वॉल्ट में इसी फ़ोल्डर में सहेजे जाते हैं।",
  pageZoom: "पेज ज़ूम",
  pageZoomDesc: "लाइव ब्राउज़र सतहों के लिए डिफ़ॉल्ट ज़ूम।",
  readerFontSize: "रीडर फ़ॉन्ट आकार",
  readerFontSizeDesc: "रीडर/कैश लेयर का फ़ॉन्ट आकार।",
  desktopView: "डेस्कटॉप दृश्य",
  desktopViewDesc: "अधिक चौड़ी लाइव ब्राउज़र सतह का उपयोग करें।",
  userAgent: "यूज़र एजेंट",
  userAgentDesc: "आंतरिक फ़ेच/खोज/डाउनलोड अनुरोधों और लाइव ब्राउज़र सतह में उपयोग होता है जहाँ Obsidian नियंत्रण देता है।",
  mobile: "मोबाइल",
  desktop: "डेस्कटॉप",
  downloadDesc: "फ़ाइलें, HTML, MHT और ऑफ़लाइन पेज सहेजें।",
  downloadFolder: "डाउनलोड फ़ोल्डर",
  downloadFolderDesc: "अधिक > डाउनलोड, HTML और MHT द्वारा सहेजी गई फ़ाइलें।",
  downloadConnections: "डाउनलोड कनेक्शन",
  downloadConnectionsDesc: "जब सर्वर फिर से शुरू होने वाले डाउनलोड का समर्थन करे, तो समानांतर बाइट-रेंज कनेक्शन।",
  browserMode: "ब्राउज़र मोड",
  browserModeDesc: "ये स्विच Browser View और Note Browser की आंतरिक रेंडरिंग को प्रभावित करते हैं।",
  nightMode: "नाइट मोड",
  nightModeDesc: "आंतरिक ब्राउज़र शेल और रीडर सतहों को गहरा करता है।",
  eyeProtection: "आँखों की सुरक्षा",
  eyeProtectionDesc: "अधिक मुलायम पठन रंग लागू करता है।",
  adBlock: "विज्ञापन अवरोध",
  adBlockDesc: "जहाँ पेज सुलभ हो, सामान्य विज्ञापन कंटेनर हटाता है।",
  markAds: "विज्ञापन चिह्नित करें",
  markAdsDesc: "जहाँ पेज सुलभ हो, संभावित विज्ञापन कंटेनरों को चिह्नित करता है।",
  incognito: "इनकॉग्निटो",
  incognitoDesc: "इतिहास और रीडर कैश लेखन रोकता है।",
  disableJavaScript: "JavaScript अक्षम करें",
  disableJavaScriptDesc: "सैंडबॉक्स में allow-scripts के बिना लाइव पेज फिर से लोड करता है।",
  rotateScreen: "स्क्रीन घुमाएँ",
  rotateScreenDesc: "अधिक चौड़ी लैंडस्केप-जैसी ब्राउज़र सतह का उपयोग करता है।",
  dataImportExport: "डेटा आयात-निर्यात",
  dataImportExportDesc: "बुकमार्क, रीडिंग सूची, इतिहास, डाउनलोड, स्क्रिप्ट नियम, वेब नोट्स और सामान्य सेटिंग्स।",
  universalExport: "सार्वभौमिक निर्यात",
  universalExportDesc: "पोर्टेबल Mobile Webviewer JSON पैकेज डाउनलोड फ़ोल्डर में सहेजें।",
  exportJson: "JSON निर्यात",
  copyJson: "JSON कॉपी",
  universalImport: "सार्वभौमिक आयात",
  universalImportDesc: "क्लिपबोर्ड से Mobile Webviewer JSON, सामान्य बुकमार्क HTML या सादे URL पंक्तियाँ आयात करें। मौजूदा डेटा मर्ज होता है।",
  importClipboard: "क्लिपबोर्ड से आयात",
  translation: "अनुवाद",
  translationDesc: "डिफ़ॉल्ट रूप से Obsidian भाषा का पालन करे, या निश्चित लक्ष्य भाषा चुनें।",
  defaultTranslationLanguage: "डिफ़ॉल्ट अनुवाद भाषा",
  defaultTranslationLanguageDesc: "अधिक > अनुवाद और भाषा चयनकर्ता में उपयोग होता है। Obsidian का पालन अनुवाद को Obsidian की वर्तमान UI भाषा से जोड़ता है।",
  scriptsReader: "स्क्रिप्ट और रीडर लेयर",
  scriptsReaderDesc: "रीडर लेयर CSS, JavaScript और URL-मिलान स्क्रिप्ट नियम।",
  readerUserScripts: "रीडर यूज़र स्क्रिप्ट",
  readerUserScriptsDesc: "आंतरिक रीडर लेयर पर कस्टम CSS और JavaScript लागू करें।",
  readerCss: "रीडर CSS",
  readerCssDesc: "रेंडर किए गए रीडर/कैश पेजों में इंजेक्ट होने वाला CSS।",
  readerJavascript: "रीडर JavaScript",
  readerJavascriptDesc: "container, page और hostName के साथ चलता है।",
  userScriptRules: "यूज़र स्क्रिप्ट नियम",
  rulesCount: "नियम ({count})",
  rulesDesc: "आंतरिक रीडर लेयर के लिए URL-मिलान CSS और JavaScript।",
  addRule: "नियम जोड़ें",
  ruleName: "नियम नाम",
  delete: "हटाएँ",
  match: "मिलान",
  matchDesc: "सबस्ट्रिंग या वाइल्डकार्ड समर्थन, जैसे *://*.example.com/*",
  css: "CSS",
  cssDesc: "मिलान होने वाले रीडर पेजों में इंजेक्ट होता है।",
  javascript: "JavaScript",
  javascriptDesc: "container, page, hostName और rule के साथ चलता है।",
  autofill: "ऑटोफिल",
  autofillDesc: "अधिक > पेज ऑटोफिल में उपयोग; केवल सुलभ खाली फ़ील्ड भरता है।",
  autofillName: "ऑटोफिल नाम",
  autofillEmail: "ऑटोफिल ईमेल",
  autofillPhone: "ऑटोफिल फ़ोन",
  autofillAddress: "ऑटोफिल पता",
  autofillFieldDesc: "अधिक > पेज ऑटोफिल में उपयोग होता है।",
  dataMaintenance: "डेटा रखरखाव",
  dataMaintenanceDesc: "ब्राउज़िंग इतिहास, रीडर कैश, डाउनलोड और कंसोल लॉग साफ़ करें।",
  clearHistory: "इतिहास साफ़ करें",
  clearReaderCache: "रीडर कैश साफ़ करें",
  clearDownloads: "डाउनलोड साफ़ करें",
  readingList: "रीडिंग सूची",
  clearConsole: "कंसोल साफ़ करें",
  clearBrowsingData: "ब्राउज़िंग डेटा साफ़ करें",
  clearBrowsingDataDesc: "इतिहास, रीडर कैश और कंसोल प्रविष्टियाँ साफ़ करता है। बुकमार्क, रीडिंग सूची और फ़ाइलें बनी रहती हैं।",
  exportBookmarkNote: "बुकमार्क नोट निर्यात",
  exportBookmarkNoteDesc: "वर्तमान बुकमार्क वाली Markdown नोट बनाएँ।",
  clear: "साफ़ करें",
  create: "बनाएँ",
  savedEntries: "{count} प्रविष्टियाँ सहेजी गईं।",
  cachedPages: "{count} पेज कैश किए गए।",
  downloadRecords: "{count} डाउनलोड रिकॉर्ड सहेजे गए। फ़ाइलें नहीं हटतीं।",
  savedPages: "{count} पेज सहेजे गए।",
  consoleEntries: "{count} कंसोल प्रविष्टियाँ।",
  supportCodes: "समर्थन कोड",
  supportCodesDesc: "यदि यह प्लगइन मदद करता है, तो निरंतर रखरखाव हेतु कोड स्कैन करें।",
  searchOrEnterUrl: "खोजें या URL दर्ज करें",
  go: "जाएँ",
  closeMore: "अधिक बंद करें",
  ready: "तैयार",
  closePanel: "पैनल बंद करें",
  bookmark: "बुकमार्क",
  saveLink: "लिंक सहेजें",
  noBookmarksYet: "अभी कोई बुकमार्क नहीं",
  noReadingListYet: "अभी कोई रीडिंग सूची नहीं",
  noHistoryYet: "अभी कोई इतिहास नहीं",
  noDownloadsYet: "कोई डाउनलोड नहीं",
  noConsoleLogs: "कोई कंसोल लॉग नहीं",
  searchingBing: "Bing पर खोज रहे हैं...",
  resultsCount: "{count} परिणाम",
  loadFailedRetry: "लोड विफल, फिर कोशिश करें",
  nativeLightHome: "नेटिव हल्का होम",
  readingStatus: "पढ़ा जा रहा है...",
  pageTools: "पेज उपकरण",
  doodle: "डूडल",
  closeDoodle: "डूडल बंद करें",
  editableWebNote: "संपादन योग्य वेब नोट",
  autoSavedPlugin: "प्लगइन में ऑटो-सेव",
  saving: "सहेज रहे हैं...",
  savedPlugin: "प्लगइन में सहेजा गया",
  savedMarkdown: "{path} में सहेजा गया",
  webNoteSaved: "वेब नोट प्लगइन डेटा में सहेजा गया",
  savedTo: "{path} में सहेजा गया",
  bookmarkAdded: "बुकमार्क जोड़ा गया",
  bookmarkRemoved: "बुकमार्क हटाया गया",
  noPreviousPage: "कोई पिछला पेज नहीं",
  noNextPage: "कोई अगला पेज नहीं",
  internalBrowserTab: "आंतरिक ब्राउज़र टैब",
  refresh: "रिफ्रेश",
  openCancip: "Cancip खोलें",
  all: "सभी",
  completed: "पूर्ण",
  failed: "विफल",
  today: "आज",
  latest: "नवीनतम",
  downloadState: "{status} · {progress}%",
  openFile: "खोलें",
  copyPath: "पथ कॉपी",
  location: "स्थान",
  source: "स्रोत",
  cancipDetected: "Cancip AI मिला",
  cancipNotEnabled: "Cancip AI सक्रिय नहीं है",
  cancipDetectedDesc: "संस्करण {version}; AI पैनल यहाँ से खोलें।",
  cancipNotEnabledDesc: "Cancip इंस्टॉल या सक्रिय करने के बाद, Mobile Webviewer वर्तमान वेब संदर्भ को AI प्रवेश के रूप में दे सकता है।",
  copyCurrentContext: "वर्तमान वेब संदर्भ कॉपी",
  sendCurrentToCancip: "वर्तमान पेज Cancip को भेजें",
  sentCurrentToCancip: "वर्तमान पेज Cancip में जोड़ा गया",
  cancipContextPrompt: "विश्लेषण, व्यवस्था, उद्धरण या नोट निर्माण हेतु इस वेब संदर्भ का उपयोग करें।",
  copiedCancipContext: "Cancip संदर्भ कॉपी हुआ",
  downloadComplete: "डाउनलोड पूर्ण: {path}",
  newTab: "नया टैब",
  openLink: "लिंक खोलें",
  openInNewTab: "नए टैब में खोलें",
  downloadLink: "लिंक डाउनलोड",
  downloadSavedTo: "डाउनलोड सहेजे गए: {folder}",
  tabs: "टैब",
  downloadPage: "डाउनलोड ({count})",
  bookmarksCount: "बुकमार्क ({count})",
  historyCount: "इतिहास ({count})",
  readingCount: "रीडिंग ({count})",
  consoleCount: "लॉग ({count})",
  downloadsCount: "डाउनलोड ({count})",
  newObTab: "नया OB टैब",
  openNoteWeb: "Note Web खोलें",
  openInBrowser: "ब्राउज़र में खोलें",
  share: "साझा करें",
  browserStatus: "ब्राउज़र स्थिति",
  zoomIn: "ज़ूम इन {value}%",
  zoomOut: "ज़ूम आउट",
  mobileVersion: "मोबाइल संस्करण",
  desktopVersion: "डेस्कटॉप संस्करण",
  dayMode: "डे मोड",
  closeEyeProtection: "आँखों की सुरक्षा बंद",
  closeAdBlock: "विज्ञापन अवरोध बंद",
  adBlocking: "विज्ञापन अवरोध",
  unmarkAds: "विज्ञापन चिह्न हटाएँ",
  closeIncognito: "इनकॉग्निटो बंद",
  exitFullscreen: "फ़ुलस्क्रीन से बाहर",
  fullscreen: "फ़ुलस्क्रीन",
  enableJs: "JS सक्रिय करें",
  disableJs: "JS अक्षम करें",
  closeLandscape: "लैंडस्केप बंद",
  landscape: "लैंडस्केप",
  fontSize: "फ़ॉन्ट आकार {value}%",
  downloadFile: "फ़ाइल डाउनलोड",
  saveHtml: "HTML सहेजें",
  saveMht: "MHT सहेजें",
  offlinePage: "ऑफ़लाइन पेज",
  desktopShortcut: "डेस्कटॉप शॉर्टकट",
  removeBookmark: "बुकमार्क हटाएँ",
  addBookmark: "बुकमार्क जोड़ें",
  addReadingList: "रीडिंग सूची में जोड़ें",
  autofillPage: "पेज ऑटोफिल",
  scriptsCount: "स्क्रिप्ट ({count})",
  mediaSniff: "मीडिया खोज",
  pageAssets: "पेज संसाधन",
  copySource: "स्रोत कॉपी",
  viewSource: "स्रोत देखें",
  readAloud: "पढ़कर सुनाएँ",
  report: "रिपोर्ट",
  copyLogs: "लॉग कॉपी",
  clearCache: "कैश साफ़ ({count})",
  siteSettings: "साइट सेटिंग्स",
  toolStatus: "उपकरण स्थिति",
  clearBrowsingDataAction: "ब्राउज़िंग डेटा साफ़ करें",
  runningAction: "चल रहा है: {label}",
  completedAction: "पूर्ण: {label}",
  failedAction: "{label} विफल: {message}",
  downloadFinished: "डाउनलोड पूरा: {path}",
  saved: "सहेजा गया: {path}",
  addedReadingList: "रीडिंग सूची में जोड़ा गया",
  mediaCopied: "मीडिया कॉपी: {count}",
  resourcesCopied: "संसाधन कॉपी हुए",
  sourceCopied: "स्रोत कॉपी हुआ",
  consoleCopied: "कंसोल कॉपी हुआ",
  cacheCleared: "कैश साफ़ हुआ",
  browsingDataCleared: "ब्राउज़िंग डेटा साफ़ हुआ",
  translatePageTo: "पेज का अनुवाद करें...",
  newObsidianTab: "नया Obsidian टैब",
  address: "पता",
  webResultsTab: "वेब",
  imageResultsTab: "चित्र",
  videoResultsTab: "वीडियो",
  academicTab: "शैक्षणिक",
  dictionaryTab: "शब्दकोश",
  mapsTab: "मानचित्र",
  moreTab: "अधिक",
  aboutResults: "लगभग {count} परिणाम",
  learnMoreAbout: "{query} के बारे में अधिक जानें",
  webNotePlaceholder: "वेब नोट",
  fallbackEditableNote: "पेज लोडिंग सीमित; संपादन योग्य नोट लेयर बनी रहती है।",
  loadingValue: "लोड हो रहा है: {value}",
  yes: "हाँ",
  no: "नहीं",
  downloadDirectory: "डाउनलोड निर्देशिका: {folder}",
  cancipAi: "Cancip AI",
  currentOpen: "वर्तमान खोलें",
  readerExtracting: "पेज सारांश निकाला जा रहा है...",
  insertedLink: "लिंक जोड़ा गया",
  copiedMarkdownLink: "Markdown लिंक कॉपी हुआ",
  noteDrawDisabled: "NoteDraw प्लगइन सक्रिय नहीं है।",
  readerNoteNotReady: "रीडर नोट अभी तैयार नहीं",
  noWebNoteToExport: "निर्यात कोई वेब नोट नहीं",
  jsonCopied: "Mobile Webviewer JSON कॉपी हुआ",
  clipboardEmpty: "क्लिपबोर्ड खाली है",
  fileMissingPathCopied: "फ़ाइल वॉल्ट में नहीं मिली; पथ कॉपी हुआ",
  htmlSaveFailed: "HTML सहेजना विफल",
  mhtSaveFailed: "MHT सहेजना विफल",
  shareTextCopied: "साझा पाठ कॉपी हुआ",
  downloadFailed: "डाउनलोड विफल",
  cancipDisabled: "Cancip प्लगइन सक्रिय नहीं",
  noWebLinkFound: "कोई वेब लिंक नहीं मिला",
  bookmarkNoteCreated: "बुकमार्क नोट बनाया गया",
  emptyConsoleDesc: "अभी कोई लॉग नहीं। खोज, डाउनलोड, सहेजना और स्क्रिप्ट यहाँ दिखेंगे।",
  pageSource: "पेज स्रोत",
  copyReport: "रिपोर्ट कॉपी",
  reportUrl: "रिपोर्ट URL",
  reportCopied: "रिपोर्ट कॉपी हुआ",
  urlCopied: "URL कॉपी हुआ",
  translatePage: "पेज अनुवाद",
  noSavedPages: "कोई सहेजा पेज नहीं",
  noResourcesFound: "कोई संसाधन नहीं मिला",
  disabled: "अक्षम",
  noMatchingScripts: "कोई मिलान स्क्रिप्ट नहीं",
  findInPage: "पेज में खोजें",
  previous: "पिछला",
  next: "अगला",
  pageLoadLimited: "पेज लोडिंग सीमित; संपादन योग्य नोट लेयर बनी रहती है।",
  systemBrowser: "सिस्टम ब्राउज़र में खोलें",
  proxyModeActive: "साइट ने एम्बेडिंग अस्वीकार की — वास्तविक पेज अंतर्निहित प्रॉक्सी से लोड हुआ",
  postFormUnsupported: "प्रॉक्सी मोड में POST फ़ॉर्म सबमिशन समर्थित नहीं",
  uiLanguage: "इंटरफेस भाषा",
  followObsidian: "Obsidian भाषा का पालन करें",
  homePage: "होम पेज",
  searchUrl: "खोज URL",
  openBrowser: "ब्राउज़र खोलें",
  settings: "सेटिंग्स",
  more: "अधिक",
  search: "खोजें",
  searchBing: "Bing में खोजें",
  bookmarks: "बुकमार्क",
  history: "इतिहास",
  reading: "रीडिंग सूची",
  downloads: "डाउनलोड",
  console: "लॉग",
  back: "पीछे",
  forward: "आगे",
  reload: "रीलोड",
  home: "होम",
  note: "नोट",
  web: "वेब",
  noteBrowser: "नोट ब्राउज़र",
  saveMd: "MD सहेजें",
  download: "डाउनलोड",
  open: "खोलें",
  copy: "कॉपी",
  save: "सहेजें",
  tools: "टूल",
  page: "पेज",
  view: "देखें",
  close: "बंद करें",
  translateAction: "अनुवाद",
  qrCode: "QR कोड",
  copyLink: "लिंक कॉपी करें",
  copiedLink: "लिंक कॉपी हुआ",
  loading: "लोड हो रहा है...",
  searching: "खोज जारी...",
  moreResults: "और परिणाम",
  noEntries: "कोई प्रविष्टि नहीं",
  reader: "रीडर",
  links: "लिंक"
});

const UI_TEXT_FA = commonUi({
  ...UI_TEXT_AR,
  uiLanguage: "زبان رابط",
  followObsidian: "پیروی از زبان Obsidian",
  homePage: "خانه",
  searchUrl: "نشانی جستجو",
  openBrowser: "باز کردن مرورگر",
  settings: "تنظیمات",
  more: "بیشتر",
  search: "جستجو",
  searchBing: "جستجو در Bing",
  bookmarks: "نشانک‌ها",
  history: "تاریخچه",
  reading: "فهرست خواندن",
  downloads: "دانلودها",
  back: "بازگشت",
  forward: "جلو",
  reload: "بارگذاری دوباره",
  open: "باز کردن",
  copy: "کپی",
  save: "ذخیره",
  tools: "ابزارها",
  close: "بستن",
  translateAction: "ترجمه",
  copyLink: "کپی پیوند",
  copiedLink: "پیوند کپی شد",
  loading: "در حال بارگذاری...",
  searching: "در حال جستجو..."
});

const UI_TEXT_UR = commonUi({
  ...UI_TEXT_AR,
  uiLanguage: "انٹرفیس زبان",
  followObsidian: "Obsidian زبان کی پیروی",
  homePage: "مرکزی صفحہ",
  searchUrl: "تلاش URL",
  openBrowser: "براؤزر کھولیں",
  settings: "ترتیبات",
  more: "مزید",
  search: "تلاش",
  searchBing: "Bing میں تلاش",
  bookmarks: "بک مارکس",
  history: "ہسٹری",
  reading: "پڑھنے کی فہرست",
  downloads: "ڈاؤن لوڈز",
  back: "پیچھے",
  forward: "آگے",
  reload: "دوبارہ لوڈ",
  open: "کھولیں",
  copy: "کاپی",
  save: "محفوظ",
  tools: "اوزار",
  close: "بند",
  translateAction: "ترجمہ",
  copyLink: "لنک کاپی",
  copiedLink: "لنک کاپی ہو گیا",
  loading: "لوڈ ہو رہا ہے...",
  searching: "تلاش جاری..."
});

const UI_TEXT_KK = commonUi({
  ...UI_TEXT_RU,
  uiLanguage: "Интерфейс тілі",
  followObsidian: "Obsidian тілімен жүру",
  homePage: "Басты бет",
  searchUrl: "Іздеу URL",
  openBrowser: "Браузерді ашу",
  settings: "Баптаулар",
  more: "Көбірек",
  search: "Іздеу",
  searchBing: "Bing арқылы іздеу",
  bookmarks: "Бетбелгілер",
  history: "Тарих",
  reading: "Оқу тізімі",
  downloads: "Жүктеулер",
  back: "Артқа",
  forward: "Алға",
  reload: "Жаңарту",
  open: "Ашу",
  copy: "Көшіру",
  save: "Сақтау",
  tools: "Құралдар",
  close: "Жабу",
  translateAction: "Аудару",
  copiedLink: "Сілтеме көшірілді",
  loading: "Жүктелуде...",
  searching: "Ізделуде..."
});

const UI_TEXT_KY = commonUi({
  ...UI_TEXT_RU,
  uiLanguage: "Интерфейс тили",
  followObsidian: "Obsidian тилин ээрчүү",
  homePage: "Башкы бет",
  searchUrl: "Издөө URL",
  openBrowser: "Браузерди ачуу",
  settings: "Жөндөөлөр",
  more: "Көбүрөөк",
  search: "Издөө",
  searchBing: "Bing менен издөө",
  bookmarks: "Кыстармалар",
  history: "Тарых",
  reading: "Окуу тизмеси",
  downloads: "Жүктөөлөр",
  back: "Артка",
  forward: "Алга",
  reload: "Жаңыртуу",
  open: "Ачуу",
  copy: "Көчүрүү",
  save: "Сактоо",
  tools: "Куралдар",
  close: "Жабуу",
  translateAction: "Которуу",
  copiedLink: "Шилтеме көчүрүлдү",
  loading: "Жүктөлүүдө...",
  searching: "Изделүүдө..."
});

const UI_TEXT_UZ = commonUi({
  ...UI_TEXT_TR,
  uiLanguage: "Interfeys tili",
  followObsidian: "Obsidian tiliga ergashish",
  homePage: "Bosh sahifa",
  searchUrl: "Qidiruv URL",
  openBrowser: "Brauzerni ochish",
  settings: "Sozlamalar",
  more: "Ko'proq",
  search: "Qidirish",
  searchBing: "Bing orqali qidirish",
  bookmarks: "Xatcho'plar",
  history: "Tarix",
  reading: "O'qish ro'yxati",
  downloads: "Yuklamalar",
  back: "Orqaga",
  forward: "Oldinga",
  reload: "Yangilash",
  open: "Ochish",
  copy: "Nusxa olish",
  save: "Saqlash",
  tools: "Asboblar",
  close: "Yopish",
  translateAction: "Tarjima",
  copiedLink: "Havola nusxalandi",
  loading: "Yuklanmoqda...",
  searching: "Qidirilmoqda..."
});

const UI_TEXT_ID = commonUi({
  ...UI_TEXT_EN,
  clearCookies: "Hapus cookie situs",
  cookiesCleared: "Cookie situs dihapus",
  uiLanguageDesc: "Secara baku mengikuti bahasa Obsidian/sistem. Anda juga dapat menetapkan bahasa tetap untuk plugin ini.",
  coreEntry: "Pintu utama",
  coreEntryDesc: "Halaman beranda, pencarian, pintu peramban, dan perilaku saat mulai.",
  homePageDesc: "Halaman bawaan yang dibuka oleh tombol beranda.",
  searchUrlDesc: "Gunakan {{query}} sebagai penanda teks pencarian terenkode.",
  noteBrowserCurrentUrl: "URL saat ini peramban catatan",
  noteBrowserCurrentUrlDesc: "URL yang dipulihkan saat membuka peramban berbasis catatan.",
  openBrowserDesc: "Buka cepat peramban berbasis catatan dari pengaturan.",
  openOnStartup: "Buka saat mulai",
  openOnStartupDesc: "Buka peramban catatan dalam tampilan baca setelah tata letak Obsidian siap.",
  interfaceRendering: "Antarmuka dan perenderan",
  interfaceRenderingDesc: "Mengendalikan bilah alat seluler, tongkat ajaib NoteDraw, lapisan pembaca, dan skala halaman.",
  compactMobileToolbar: "Bilah alat seluler ringkas",
  compactMobileToolbarDesc: "Menggunakan kontrol lebih kecil untuk layar ponsel.",
  showNoteDrawMagicWand: "Tampilkan tongkat ajaib NoteDraw",
  showNoteDrawMagicWandDesc: "Menampilkan tombol tongkat pada permukaan Mobile Webviewer saat NoteDraw tersedia.",
  readerHint: "Petunjuk pembaca",
  readerHintDesc: "Menampilkan petunjuk lapisan pembaca saat peramban internal merender halaman bergaya catatan.",
  liveBrowserFirst: "Peramban langsung dulu",
  liveBrowserFirstDesc: "Menampilkan permukaan WebView langsung di atas lapisan pembaca bergaya catatan.",
  frontendMode: "Mode latar depan",
  frontendModeDesc: "Latar depan bawaan: catatan yang dapat disunting atau halaman web penuh.",
  editableNote: "Catatan dapat disunting",
  fullWebPage: "Halaman web penuh",
  autoSaveWebNotes: "Simpan otomatis catatan web",
  autoSaveWebNotesDesc: "Menyimpan otomatis teks pembaca yang disunting dan coretan hanya ke data plugin. Gunakan Simpan MD untuk menambah berkas Markdown ke vault.",
  webNoteFolder: "Folder catatan web",
  webNoteFolderDesc: "Ekspor Simpan MD manual disimpan di sini dalam vault.",
  pageZoom: "Zoom halaman",
  pageZoomDesc: "Zoom bawaan untuk permukaan peramban langsung.",
  readerFontSize: "Ukuran huruf pembaca",
  readerFontSizeDesc: "Ukuran huruf lapisan pembaca/tembolok.",
  desktopView: "Tampilan desktop",
  desktopViewDesc: "Menggunakan permukaan peramban langsung yang lebih lebar.",
  userAgent: "User agent",
  userAgentDesc: "Dipakai permintaan ambil/cari/unduh internal dan permukaan peramban langsung tempat Obsidian membuka kontrol.",
  mobile: "Seluler",
  desktop: "Desktop",
  download: "Unduh",
  downloadDesc: "Menyimpan berkas, HTML, MHT, dan halaman luring.",
  downloadFolder: "Folder unduhan",
  downloadFolderDesc: "Berkas yang disimpan oleh Lainnya > Unduh, HTML, dan MHT.",
  downloadConnections: "Koneksi unduhan",
  downloadConnectionsDesc: "Koneksi rentang byte paralel saat server mendukung unduhan yang dapat dilanjutkan.",
  browserMode: "Mode peramban",
  browserModeDesc: "Sakelar ini memengaruhi perenderan internal Browser View dan Note Browser.",
  nightMode: "Mode malam",
  nightModeDesc: "Menggelapkan cangkang peramban internal dan permukaan pembaca.",
  eyeProtection: "Perlindungan mata",
  eyeProtectionDesc: "Menerapkan rona baca yang lebih lembut.",
  adBlock: "Pemblokir iklan",
  adBlockDesc: "Menghapus wadah iklan umum bila halaman dapat diakses.",
  markAds: "Tandai iklan",
  markAdsDesc: "Menandai wadah yang kemungkinan iklan bila halaman dapat diakses.",
  incognito: "Penyamaran",
  incognitoDesc: "Menghentikan penulisan riwayat dan tembolok pembaca.",
  disableJavaScript: "Matikan JavaScript",
  disableJavaScriptDesc: "Memuat ulang halaman langsung tanpa allow-scripts dalam sandbox.",
  rotateScreen: "Putar layar",
  rotateScreenDesc: "Menggunakan permukaan peramban lebih lebar seperti lanskap.",
  dataImportExport: "Impor dan ekspor data",
  dataImportExportDesc: "Penanda, daftar baca, riwayat, unduhan, aturan skrip, catatan web, dan pengaturan umum.",
  universalExport: "Ekspor universal",
  universalExportDesc: "Menyimpan paket JSON portabel Mobile Webviewer ke folder unduhan.",
  exportJson: "Ekspor JSON",
  copyJson: "Salin JSON",
  universalImport: "Impor universal",
  universalImportDesc: "Impor dari papan klip: JSON Mobile Webviewer, HTML penanda umum, atau baris URL biasa. Data yang ada digabungkan.",
  importClipboard: "Impor dari papan klip",
  translation: "Terjemahan",
  translationDesc: "Secara baku mengikuti bahasa Obsidian, atau pilih bahasa target tetap.",
  defaultTranslationLanguage: "Bahasa terjemahan bawaan",
  defaultTranslationLanguageDesc: "Dipakai Lainnya > Terjemahkan dan pemilih bahasa. Ikuti Obsidian mengaitkan terjemahan dengan bahasa antarmuka Obsidian saat ini.",
  scriptsReader: "Skrip dan lapisan pembaca",
  scriptsReaderDesc: "CSS dan JavaScript lapisan pembaca serta aturan skrip berdasarkan URL.",
  readerUserScripts: "Skrip pengguna pembaca",
  readerUserScriptsDesc: "Menerapkan CSS dan JavaScript khusus ke lapisan pembaca internal.",
  readerCss: "CSS pembaca",
  readerCssDesc: "CSS yang disuntikkan ke halaman pembaca/tembolok yang dirender.",
  readerJavascript: "JavaScript pembaca",
  readerJavascriptDesc: "Berjalan dengan container, page, dan hostName.",
  userScriptRules: "Aturan skrip pengguna",
  rulesCount: "Aturan ({count})",
  rulesDesc: "CSS dan JavaScript berdasarkan URL untuk lapisan pembaca internal.",
  addRule: "Tambah aturan",
  ruleName: "Nama aturan",
  delete: "Hapus",
  match: "Kecocokan",
  matchDesc: "Mendukung substring atau wildcard, misalnya *://*.example.com/*",
  css: "CSS",
  cssDesc: "Disuntikkan ke halaman pembaca yang cocok.",
  javascript: "JavaScript",
  javascriptDesc: "Berjalan dengan container, page, hostName, dan rule.",
  autofill: "Isi otomatis",
  autofillDesc: "Dipakai Lainnya > Isi halaman; hanya mengisi kolom kosong yang dapat diakses.",
  autofillName: "Nama isi otomatis",
  autofillEmail: "Email isi otomatis",
  autofillPhone: "Telepon isi otomatis",
  autofillAddress: "Alamat isi otomatis",
  autofillFieldDesc: "Dipakai Lainnya > Isi halaman.",
  dataMaintenance: "Pemeliharaan data",
  dataMaintenanceDesc: "Membersihkan riwayat, tembolok pembaca, unduhan, dan log konsol.",
  clearHistory: "Bersihkan riwayat",
  clearReaderCache: "Bersihkan tembolok pembaca",
  clearDownloads: "Bersihkan unduhan",
  readingList: "Daftar baca",
  clearConsole: "Bersihkan konsol",
  clearBrowsingData: "Bersihkan data penjelajahan",
  clearBrowsingDataDesc: "Membersihkan riwayat, tembolok pembaca, dan entri konsol. Penanda, daftar baca, dan berkas tetap disimpan.",
  exportBookmarkNote: "Ekspor catatan penanda",
  exportBookmarkNoteDesc: "Membuat catatan Markdown berisi penanda saat ini.",
  clear: "Bersihkan",
  create: "Buat",
  savedEntries: "{count} entri tersimpan.",
  cachedPages: "{count} halaman ter-tombol.",
  downloadRecords: "{count} catatan unduhan tersimpan. Berkas tidak dihapus.",
  savedPages: "{count} halaman tersimpan.",
  consoleEntries: "{count} entri konsol.",
  supportCodes: "Kode dukungan",
  supportCodesDesc: "Jika plugin ini membantu, pindai kode untuk mendukung pemeliharaan berkelanjutan.",
  searchOrEnterUrl: "Cari atau masukkan URL",
  go: "Buka",
  closeMore: "Tutup Lainnya",
  ready: "Siap",
  console: "Konsol",
  closePanel: "Tutup panel",
  home: "Beranda",
  note: "Catatan",
  web: "Web",
  noteBrowser: "Peramban catatan",
  saveMd: "Simpan MD",
  bookmark: "Penanda",
  saveLink: "Simpan tautan",
  noBookmarksYet: "Belum ada penanda",
  noReadingListYet: "Belum ada daftar baca",
  noHistoryYet: "Belum ada riwayat",
  noDownloadsYet: "Belum ada unduhan",
  noConsoleLogs: "Tidak ada log konsol",
  searchingBing: "Mencari di Bing...",
  resultsCount: "{count} hasil",
  moreResults: "Hasil lainnya",
  loadFailedRetry: "Gagal memuat, coba lagi",
  nativeLightHome: "Beranda bawaan ringan",
  reader: "Pembaca",
  readingStatus: "Membaca...",
  pageTools: "Alat halaman",
  copyLink: "Salin tautan",
  doodle: "Coretan",
  closeDoodle: "Tutup coretan",
  editableWebNote: "Catatan web yang dapat disunting",
  links: "Tautan",
  autoSavedPlugin: "Tersimpan otomatis ke plugin",
  saving: "Menyimpan...",
  savedPlugin: "Tersimpan ke plugin",
  savedMarkdown: "Tersimpan ke {path}",
  webNoteSaved: "Catatan web tersimpan di data plugin",
  savedTo: "Tersimpan ke {path}",
  bookmarkAdded: "Penanda ditambahkan",
  bookmarkRemoved: "Penanda dihapus",
  noPreviousPage: "Tidak ada halaman sebelumnya",
  noNextPage: "Tidak ada halaman berikutnya",
  internalBrowserTab: "Tab peramban internal",
  refresh: "Segarkan",
  openCancip: "Buka Cancip",
  all: "Semua",
  completed: "Selesai",
  failed: "Gagal",
  today: "Hari ini",
  latest: "Terbaru",
  noEntries: "Tidak ada entri",
  downloadState: "{status} · {progress}%",
  openFile: "Buka",
  copyPath: "Salin jalur",
  location: "Lokasi",
  source: "Sumber",
  cancipDetected: "Cancip AI terdeteksi",
  cancipNotEnabled: "Cancip AI tidak diaktifkan",
  cancipDetectedDesc: "Versi {version}; buka panel AI dari sini.",
  cancipNotEnabledDesc: "Setelah Cancip dipasang atau diaktifkan, Mobile Webviewer dapat menyediakan konteks web saat ini sebagai pintu AI.",
  copyCurrentContext: "Salin konteks web saat ini",
  sendCurrentToCancip: "Kirim halaman saat ini ke Cancip",
  sentCurrentToCancip: "Halaman saat ini ditambahkan ke Cancip",
  cancipContextPrompt: "Gunakan konteks web ini untuk menganalisis, menata, mengutip, atau membuat catatan.",
  copiedCancipContext: "Konteks Cancip disalin",
  downloadComplete: "Unduhan selesai: {path}",
  newTab: "Tab baru",
  openLink: "Buka tautan",
  openInNewTab: "Buka di tab baru",
  downloadLink: "Unduh tautan",
  downloadSavedTo: "Unduhan disimpan ke: {folder}",
  tabs: "Tab",
  page: "Halaman",
  view: "Tampilan",
  downloadPage: "Unduhan ({count})",
  bookmarksCount: "Penanda ({count})",
  historyCount: "Riwayat ({count})",
  readingCount: "Bacaan ({count})",
  consoleCount: "Log ({count})",
  downloadsCount: "Unduhan ({count})",
  newObTab: "Tab OB baru",
  openNoteWeb: "Buka Note Web",
  openInBrowser: "Buka di peramban",
  share: "Bagikan",
  browserStatus: "Status peramban",
  zoomIn: "Perbesar {value}%",
  zoomOut: "Perkecil",
  mobileVersion: "Versi seluler",
  desktopVersion: "Versi desktop",
  dayMode: "Mode siang",
  closeEyeProtection: "Matikan perlindungan mata",
  closeAdBlock: "Matikan pemblokir iklan",
  adBlocking: "Pemblokir iklan",
  unmarkAds: "Hapus tanda iklan",
  closeIncognito: "Matikan penyamaran",
  exitFullscreen: "Keluar layar penuh",
  fullscreen: "Layar penuh",
  enableJs: "Aktifkan JS",
  disableJs: "Matikan JS",
  closeLandscape: "Matikan mode lanskap",
  landscape: "Mode lanskap",
  fontSize: "Ukuran huruf {value}%",
  downloadFile: "Unduh berkas",
  saveHtml: "Simpan HTML",
  saveMht: "Simpan MHT",
  offlinePage: "Halaman luring",
  desktopShortcut: "Pintasan desktop",
  removeBookmark: "Hapus dari penanda",
  addBookmark: "Tambah ke penanda",
  addReadingList: "Tambah ke daftar baca",
  autofillPage: "Isi halaman otomatis",
  scriptsCount: "Skrip ({count})",
  mediaSniff: "Deteksi media",
  pageAssets: "Aset halaman",
  copySource: "Salin sumber",
  viewSource: "Lihat sumber",
  readAloud: "Baca nyaring",
  qrCode: "Kode QR",
  report: "Laporan",
  copyLogs: "Salin log",
  clearCache: "Bersihkan tembolok ({count})",
  siteSettings: "Pengaturan situs",
  toolStatus: "Status alat",
  clearBrowsingDataAction: "Bersihkan data penjelajahan",
  runningAction: "Berjalan: {label}",
  completedAction: "Selesai: {label}",
  failedAction: "{label} gagal: {message}",
  downloadFinished: "Unduhan selesai: {path}",
  saved: "Tersimpan: {path}",
  addedReadingList: "Ditambahkan ke daftar baca",
  mediaCopied: "Media disalin: {count}",
  resourcesCopied: "Sumber daya disalin",
  sourceCopied: "Sumber disalin",
  consoleCopied: "Konsol disalin",
  cacheCleared: "Tembolok dibersihkan",
  browsingDataCleared: "Data penjelajahan dibersihkan",
  translatePageTo: "Terjemahkan halaman ke...",
  newObsidianTab: "Tab Obsidian baru",
  address: "Alamat",
  webResultsTab: "Web",
  imageResultsTab: "Gambar",
  videoResultsTab: "Video",
  academicTab: "Akademik",
  dictionaryTab: "Kamus",
  mapsTab: "Peta",
  moreTab: "Lainnya",
  aboutResults: "Sekitar {count} hasil",
  learnMoreAbout: "Pelajari lebih lanjut tentang {query}",
  webNotePlaceholder: "Catatan web",
  fallbackEditableNote: "Pemuatan halaman terbatas; lapisan catatan yang dapat disunting tetap disimpan.",
  loadingValue: "Memuat: {value}",
  yes: "Ya",
  no: "Tidak",
  downloadDirectory: "Direktori unduhan: {folder}",
  cancipAi: "Cancip AI",
  currentOpen: "Buka yang saat ini",
  readerExtracting: "Mengekstrak ringkasan halaman...",
  insertedLink: "Tautan disisipkan",
  copiedMarkdownLink: "Tautan Markdown disalin",
  noteDrawDisabled: "Plugin NoteDraw tidak aktif.",
  readerNoteNotReady: "Catatan pembaca belum siap",
  noWebNoteToExport: "Tidak ada catatan web untuk diekspor",
  jsonCopied: "JSON Mobile Webviewer disalin",
  clipboardEmpty: "Papan klip kosong",
  fileMissingPathCopied: "Berkas tidak ditemukan di vault; jalur disalin",
  htmlSaveFailed: "Gagal menyimpan HTML",
  mhtSaveFailed: "Gagal menyimpan MHT",
  shareTextCopied: "Teks berbagi disalin",
  downloadFailed: "Unduhan gagal",
  cancipDisabled: "Plugin Cancip tidak aktif",
  noWebLinkFound: "Tautan web tidak ditemukan",
  bookmarkNoteCreated: "Catatan penanda dibuat",
  emptyConsoleDesc: "Belum ada log. Pencarian, unduhan, penyimpanan, dan skrip akan muncul di sini.",
  pageSource: "Sumber halaman",
  copyReport: "Salin laporan",
  reportUrl: "URL laporan",
  reportCopied: "Laporan disalin",
  urlCopied: "URL disalin",
  translatePage: "Terjemahkan halaman",
  noSavedPages: "Tidak ada halaman tersimpan",
  noResourcesFound: "Tidak ada sumber daya",
  disabled: "Nonaktif",
  noMatchingScripts: "Tidak ada skrip yang cocok",
  findInPage: "Cari di halaman",
  previous: "Sebelumnya",
  next: "Berikutnya",
  pageLoadLimited: "Pemuatan halaman terbatas; lapisan catatan yang dapat disunting tetap disimpan.",
  systemBrowser: "Buka di peramban sistem",
  proxyModeActive: "Situs menolak penyematan — halaman asli dimuat lewat proxy bawaan",
  postFormUnsupported: "Pengiriman formulir POST tidak didukung dalam mode proxy",
  uiLanguage: "Bahasa antarmuka",
  followObsidian: "Ikuti bahasa Obsidian",
  homePage: "Beranda",
  searchUrl: "URL pencarian",
  openBrowser: "Buka browser",
  settings: "Pengaturan",
  more: "Lainnya",
  search: "Cari",
  searchBing: "Cari di Bing",
  bookmarks: "Markah",
  history: "Riwayat",
  reading: "Daftar baca",
  downloads: "Unduhan",
  back: "Kembali",
  forward: "Maju",
  reload: "Muat ulang",
  open: "Buka",
  copy: "Salin",
  save: "Simpan",
  tools: "Alat",
  close: "Tutup",
  translateAction: "Terjemahkan",
  copiedLink: "Tautan disalin",
  loading: "Memuat...",
  searching: "Mencari..."
});

const UI_TEXT_MS = commonUi({
  ...UI_TEXT_ID,
  uiLanguage: "Bahasa antara muka",
  homePage: "Laman utama",
  searchUrl: "URL carian",
  openBrowser: "Buka pelayar",
  settings: "Tetapan",
  search: "Cari",
  bookmarks: "Penanda halaman",
  history: "Sejarah",
  reading: "Senarai bacaan",
  downloads: "Muat turun",
  back: "Kembali",
  forward: "Ke depan",
  reload: "Muat semula",
  copiedLink: "Pautan disalin"
});

const UI_TEXT_TH = commonUi({
  clearCookies: "ล้างคุกกี้ของเว็บ",
  cookiesCleared: "ล้างคุกกี้ของเว็บแล้ว",
  uiLanguageDesc: "ตามภาษา Obsidian/ระบบโดยค่าเริ่มต้น คุณยังกำหนดภาษาคงที่ให้ปลั๊กอินได้",
  coreEntry: "ทางเข้าหลัก",
  coreEntryDesc: "หน้าแรก การค้นหา ทางเข้าเบราว์เซอร์ และพฤติกรรมตอนเริ่มทำงาน",
  homePageDesc: "หน้าเริ่มต้นที่ปุ่มหน้าแรกเปิด",
  searchUrlDesc: "ใช้ {{query}} เป็นตัวแทนของข้อความค้นหาที่เข้ารหัสแล้ว",
  noteBrowserCurrentUrl: "URL ปัจจุบันของเบราว์เซอร์โน้ต",
  noteBrowserCurrentUrlDesc: "URL ที่ถูกกู้คืนเมื่อเปิดเบราว์เซอร์แบบโน้ต",
  openBrowserDesc: "เปิดเบราว์เซอร์แบบโน้ตอย่างรวดเร็วจากการตั้งค่า",
  openOnStartup: "เปิดตอนเริ่มทำงาน",
  openOnStartupDesc: "เปิดเบราว์เซอร์โน้ตในมุมมองอ่านเมื่อเลย์เอาต์ของ Obsidian พร้อมแล้ว",
  interfaceRendering: "อินเทอร์เฟซและการเรนเดอร์",
  interfaceRenderingDesc: "ควบคุมแถบเครื่องมือมือถือ ไม้กายวิถี NoteDraw ชั้นตัวอ่าน และมาตราส่วนหน้า",
  compactMobileToolbar: "แถบเครื่องมือมือถือแบบกะทัดรัด",
  compactMobileToolbarDesc: "ใช้ตัวควบคุมขนาดเล็กสำหรับหน้าจอโทรศัพท์",
  showNoteDrawMagicWand: "แสดงไม้กายวิถี NoteDraw",
  showNoteDrawMagicWandDesc: "แสดงปุ่มไม้กายวิถีบนพื้นผิว Mobile Webviewer เมื่อ NoteDraw พร้อมใช้",
  readerHint: "คำใบ้ตัวอ่าน",
  readerHintDesc: "แสดงคำใบ้ชั้นตัวอ่านเมื่อเบราว์เซอร์ภายในแสดงหน้าแบบโน้ต",
  liveBrowserFirst: "เบราว์เซอร์สดมาก่อน",
  liveBrowserFirstDesc: "แสดงพื้นผิว WebView สดเหนือชั้นตัวอ่านแบบโน้ต",
  frontendMode: "โหมดพื้นหน้า",
  frontendModeDesc: "พื้นหน้าเริ่มต้น: โน้ตแก้ไขได้ หรือหน้าเว็บเต็ม",
  editableNote: "โน้ตแก้ไขได้",
  fullWebPage: "หน้าเว็บเต็ม",
  autoSaveWebNotes: "บันทึกโน้ตเว็บอัตโนมัติ",
  autoSaveWebNotesDesc: "บันทึกข้อความตัวอ่านที่แก้ไขและภาพร่างลงข้อมูลปลั๊กอินเท่านั้น ใช้บันทึก MD เพื่อเพิ่มไฟล์ Markdown ลง vault",
  webNoteFolder: "โฟลเดอร์โน้ตเว็บ",
  webNoteFolderDesc: "การส่งออกบันทึก MD แบบด้วยมือถูกบันทึกที่นี่ใน vault",
  pageZoom: "ซูมหน้า",
  pageZoomDesc: "การซูมเริ่มต้นสำหรับพื้นผิวเบราว์เซอร์สด",
  readerFontSize: "ขนาดฟอนต์ตัวอ่าน",
  readerFontSizeDesc: "ขนาดฟอนต์ของชั้นตัวอ่าน/แคช",
  desktopView: "มุมมองเดสก์ท็อป",
  desktopViewDesc: "ใช้พื้นผิวเบราว์เซอร์สดที่กว้างขึ้น",
  userAgent: "User agent",
  userAgentDesc: "ใช้กับคำขอดึง/ค้น/ดาวน์โหลดภายใน และพื้นผิวเบราว์เซอร์สดที่ Obsidian เปิดการควบคุม",
  mobile: "มือถือ",
  desktop: "เดสก์ท็อป",
  downloadDesc: "บันทึกไฟล์ HTML MHT และหน้าออฟไลน์",
  downloadFolder: "โฟลเดอร์ดาวน์โหลด",
  downloadFolderDesc: "ไฟล์ที่บันทึกโดย เพิ่มเติม > ดาวน์โหลด HTML และ MHT",
  downloadConnections: "การเชื่อมต่อดาวน์โหลด",
  downloadConnectionsDesc: "การเชื่อมต่อช่วงไบต์แบบขนานเมื่อเซิร์ฟเวอร์รองรับการดาวน์โหลดต่อได้",
  browserMode: "โหมดเบราว์เซอร์",
  browserModeDesc: "สวิตช์เหล่านี้มีผลต่อการเรนเดอร์ภายในของ Browser View และ Note Browser",
  nightMode: "โหมดกลางคืน",
  nightModeDesc: "ทำให้เปลือกเบราว์เซอร์ภายในและพื้นผิวตัวอ่านมืดลง",
  eyeProtection: "ปกป้องดวงตา",
  eyeProtectionDesc: "ใช้โทนสีอ่านที่นุ่มนวลขึ้น",
  adBlock: "บล็อกโฆษณา",
  adBlockDesc: "ลบคอนเทนเนอร์โฆษณาทั่วไปเมื่อหน้าเข้าถึงได้",
  markAds: "ทำเครื่องหมายโฆษณา",
  markAdsDesc: "ทำเครื่องหมายคอนเทนเนอร์ที่น่าจะเป็นโฆษณาเมื่อหน้าเข้าถึงได้",
  incognito: "ไม่ระบุตัวตน",
  incognitoDesc: "หยุดการเขียนประวัติและแคชตัวอ่าน",
  disableJavaScript: "ปิด JavaScript",
  disableJavaScriptDesc: "โหลดหน้าสดซ้ำโดยไม่มี allow-scripts ในแซนด์บ็อกซ์",
  rotateScreen: "หมุนหน้าจอ",
  rotateScreenDesc: "ใช้พื้นผิวเบราว์เซอร์กว้างขึ้นแบบแนวนอน",
  dataImportExport: "นำเข้าและส่งออกข้อมูล",
  dataImportExportDesc: "บุ๊กมาร์ก รายการอ่าน ประวัติ ดาวน์โหลด กฎสคริปต์ โน้ตเว็บ และการตั้งค่าทั่วไป",
  universalExport: "ส่งออกสากล",
  universalExportDesc: "บันทึกแพ็กเกจ JSON พกพาของ Mobile Webviewer ลงโฟลเดอร์ดาวน์โหลด",
  exportJson: "ส่งออก JSON",
  copyJson: "คัดลอก JSON",
  universalImport: "นำเข้าสากล",
  universalImportDesc: "นำเข้าจากคลิปบอร์ด: JSON ของ Mobile Webviewer, HTML บุ๊กมาร์กทั่วไป หรือบรรทัด URL ธรรมดา ข้อมูลที่มีอยู่จะถูกรวมเข้าด้วยกัน",
  importClipboard: "นำเข้าจากคลิปบอร์ด",
  translation: "การแปล",
  translationDesc: "ตามภาษา Obsidian โดยค่าเริ่มต้น หรือเลือกภาษาเป้าหมายคงที่",
  defaultTranslationLanguage: "ภาษาแปลเริ่มต้น",
  defaultTranslationLanguageDesc: "ใช้ใน เพิ่มเติม > แปล และตัวเลือกภาษา ตาม Obsidian จะผูกการแปลกับภาษาอินเทอร์เฟซปัจจุบันของ Obsidian",
  scriptsReader: "สคริปต์และชั้นตัวอ่าน",
  scriptsReaderDesc: "CSS และ JavaScript ของชั้นตัวอ่าน และกฎสคริปต์แบบจับคู่ URL",
  readerUserScripts: "สคริปต์ผู้ใช้ของตัวอ่าน",
  readerUserScriptsDesc: "ใช้ CSS และ JavaScript แบบกำหนดเองกับชั้นตัวอ่านภายใน",
  readerCss: "CSS ตัวอ่าน",
  readerCssDesc: "CSS ที่ฉีดเข้าหน้าตัวอ่าน/แคชที่เรนเดอร์แล้ว",
  readerJavascript: "JavaScript ตัวอ่าน",
  readerJavascriptDesc: "ทำงานพร้อม container, page และ hostName",
  userScriptRules: "กฎสคริปต์ผู้ใช้",
  rulesCount: "กฎ ({count})",
  rulesDesc: "CSS และ JavaScript แบบจับคู่ URL สำหรับชั้นตัวอ่านภายใน",
  addRule: "เพิ่มกฎ",
  ruleName: "ชื่อกฎ",
  delete: "ลบ",
  match: "การจับคู่",
  matchDesc: "รองรับสตริงย่อยหรือไวลด์การ์ด เช่น *://*.example.com/*",
  css: "CSS",
  cssDesc: "ฉีดเข้าหน้าตัวอ่านที่จับคู่ได้",
  javascript: "JavaScript",
  javascriptDesc: "ทำงานพร้อม container, page, hostName และ rule",
  autofill: "กรอกอัตโนมัติ",
  autofillDesc: "ใช้ใน เพิ่มเติม > กรอกหน้าอัตโนมัติ; กรอกเฉพาะฟิลด์ว่างที่เข้าถึงได้",
  autofillName: "ชื่อกรอกอัตโนมัติ",
  autofillEmail: "อีเมลกรอกอัตโนมัติ",
  autofillPhone: "โทรศัพท์กรอกอัตโนมัติ",
  autofillAddress: "ที่อยู่กรอกอัตโนมัติ",
  autofillFieldDesc: "ใช้ใน เพิ่มเติม > กรอกหน้าอัตโนมัติ",
  dataMaintenance: "การดูแลข้อมูล",
  dataMaintenanceDesc: "ล้างประวัติการเรียกดู แคชตัวอ่าน ดาวน์โหลด และบันทึกคอนโซล",
  clearHistory: "ล้างประวัติ",
  clearReaderCache: "ล้างแคชตัวอ่าน",
  clearDownloads: "ล้างดาวน์โหลด",
  readingList: "รายการอ่าน",
  clearConsole: "ล้างคอนโซล",
  clearBrowsingData: "ล้างข้อมูลการเรียกดู",
  clearBrowsingDataDesc: "ล้างประวัติ แคชตัวอ่าน และรายการคอนโซล บุ๊กมาร์ก รายการอ่าน และไฟล์ยังอยู่",
  exportBookmarkNote: "ส่งออกโน้ตบุ๊กมาร์ก",
  exportBookmarkNoteDesc: "สร้างโน้ต Markdown ที่มีบุ๊กมาร์กปัจจุบัน",
  clear: "ล้าง",
  create: "สร้าง",
  savedEntries: "บันทึกแล้ว {count} รายการ",
  cachedPages: "แคชแล้ว {count} หน้า",
  downloadRecords: "บันทึกการดาวน์โหลดแล้ว {count} รายการ ไฟล์ไม่ถูกลบ",
  savedPages: "บันทึกแล้ว {count} หน้า",
  consoleEntries: "{count} รายการคอนโซล",
  supportCodes: "รหัสสนับสนุน",
  supportCodesDesc: "หากปลั๊กอินนี้ช่วยคุณได้ สแกนรหัสเพื่อสนับสนุนการดูแลต่อเนื่อง",
  searchOrEnterUrl: "ค้นหาหรือป้อน URL",
  go: "ไป",
  closeMore: "ปิดเพิ่มเติม",
  ready: "พร้อม",
  closePanel: "ปิดแผง",
  bookmark: "บุ๊กมาร์ก",
  saveLink: "บันทึกลิงก์",
  noBookmarksYet: "ยังไม่มีบุ๊กมาร์ก",
  noReadingListYet: "ยังไม่มีรายการอ่าน",
  noHistoryYet: "ยังไม่มีประวัติ",
  noDownloadsYet: "ยังไม่มีการดาวน์โหลด",
  noConsoleLogs: "ไม่มีบันทึกคอนโซล",
  searchingBing: "กำลังค้นหาใน Bing...",
  resultsCount: "{count} ผลลัพธ์",
  loadFailedRetry: "โหลดไม่สำเร็จ ลองอีกครั้ง",
  nativeLightHome: "หน้าแรกเบาแบบเนทีฟ",
  readingStatus: "กำลังอ่าน...",
  pageTools: "เครื่องมือหน้า",
  doodle: "ภาพร่าง",
  closeDoodle: "ปิดภาพร่าง",
  editableWebNote: "โน้ตเว็บแก้ไขได้",
  autoSavedPlugin: "บันทึกอัตโนมัติลงปลั๊กอิน",
  saving: "กำลังบันทึก...",
  savedPlugin: "บันทึกลงปลั๊กอินแล้ว",
  savedMarkdown: "บันทึกไปที่ {path}",
  webNoteSaved: "บันทึกโน้ตเว็บลงข้อมูลปลั๊กอินแล้ว",
  savedTo: "บันทึกไปที่ {path}",
  bookmarkAdded: "เพิ่มบุ๊กมาร์กแล้ว",
  bookmarkRemoved: "ลบบุ๊กมาร์กแล้ว",
  noPreviousPage: "ไม่มีหน้าก่อนหน้า",
  noNextPage: "ไม่มีหน้าถัดไป",
  internalBrowserTab: "แท็บเบราว์เซอร์ภายใน",
  refresh: "รีเฟรช",
  openCancip: "เปิด Cancip",
  all: "ทั้งหมด",
  completed: "เสร็จสิ้น",
  failed: "ล้มเหลว",
  today: "วันนี้",
  latest: "ล่าสุด",
  downloadState: "{status} · {progress}%",
  openFile: "เปิด",
  copyPath: "คัดลอกเส้นทาง",
  location: "ตำแหน่ง",
  source: "แหล่งที่มา",
  cancipDetected: "พบ Cancip AI",
  cancipNotEnabled: "Cancip AI ยังไม่เปิดใช้",
  cancipDetectedDesc: "เวอร์ชัน {version}; เปิดแผง AI จากที่นี่",
  cancipNotEnabledDesc: "หลังติดตั้งหรือเปิดใช้ Cancip, Mobile Webviewer สามารถให้บริบทเว็บปัจจุบันเป็นทางเข้า AI ได้",
  copyCurrentContext: "คัดลอกบริบทเว็บปัจจุบัน",
  sendCurrentToCancip: "ส่งหน้าปัจจุบันไปที่ Cancip",
  sentCurrentToCancip: "เพิ่มหน้าปัจจุบันลง Cancip แล้ว",
  cancipContextPrompt: "ใช้บริบทเว็บนี้เพื่อวิเคราะห์ จัดระเบียบ ตัดทอน หรือสร้างโน้ต",
  copiedCancipContext: "คัดลอกบริบท Cancip แล้ว",
  downloadComplete: "ดาวน์โหลดเสร็จ: {path}",
  newTab: "แท็บใหม่",
  openLink: "เปิดลิงก์",
  openInNewTab: "เปิดในแท็บใหม่",
  downloadLink: "ดาวน์โหลดลิงก์",
  downloadSavedTo: "ดาวน์โหลดถูกบันทึกที่: {folder}",
  tabs: "แท็บ",
  downloadPage: "ดาวน์โหลด ({count})",
  bookmarksCount: "บุ๊กมาร์ก ({count})",
  historyCount: "ประวัติ ({count})",
  readingCount: "การอ่าน ({count})",
  consoleCount: "บันทึก ({count})",
  downloadsCount: "ดาวน์โหลด ({count})",
  newObTab: "แท็บ OB ใหม่",
  openNoteWeb: "เปิด Note Web",
  openInBrowser: "เปิดในเบราว์เซอร์",
  share: "แชร์",
  browserStatus: "สถานะเบราว์เซอร์",
  zoomIn: "ซูมเข้า {value}%",
  zoomOut: "ซูมออก",
  mobileVersion: "เวอร์ชันมือถือ",
  desktopVersion: "เวอร์ชันเดสก์ท็อป",
  dayMode: "โหมดกลางวัน",
  closeEyeProtection: "ปิดปกป้องดวงตา",
  closeAdBlock: "ปิดบล็อกโฆษณา",
  adBlocking: "บล็อกโฆษณา",
  unmarkAds: "ยกเลิกเครื่องหมายโฆษณา",
  closeIncognito: "ปิดไม่ระบุตัวตน",
  exitFullscreen: "ออกจากเต็มหน้าจอ",
  fullscreen: "เต็มหน้าจอ",
  enableJs: "เปิด JS",
  disableJs: "ปิด JS",
  closeLandscape: "ปิดแนวนอน",
  landscape: "แนวนอน",
  fontSize: "ขนาดฟอนต์ {value}%",
  downloadFile: "ดาวน์โหลดไฟล์",
  saveHtml: "บันทึก HTML",
  saveMht: "บันทึก MHT",
  offlinePage: "หน้าออฟไลน์",
  desktopShortcut: "ทางลัดเดสก์ท็อป",
  removeBookmark: "ลบจากบุ๊กมาร์ก",
  addBookmark: "เพิ่มบุ๊กมาร์ก",
  addReadingList: "เพิ่มลงรายการอ่าน",
  autofillPage: "กรอกหน้าอัตโนมัติ",
  scriptsCount: "สคริปต์ ({count})",
  mediaSniff: "สืบค้นสื่อ",
  pageAssets: "ทรัพยากรหน้า",
  copySource: "คัดลอกซอร์ส",
  viewSource: "ดูซอร์ส",
  readAloud: "อ่านออกเสียง",
  report: "รายงาน",
  copyLogs: "คัดลอกบันทึก",
  clearCache: "ล้างแคช ({count})",
  siteSettings: "การตั้งค่าไซต์",
  toolStatus: "สถานะเครื่องมือ",
  clearBrowsingDataAction: "ล้างข้อมูลการเรียกดู",
  runningAction: "กำลังทำงาน: {label}",
  completedAction: "เสร็จสิ้น: {label}",
  failedAction: "{label} ล้มเหลว: {message}",
  downloadFinished: "ดาวน์โหลดเสร็จ: {path}",
  saved: "บันทึกแล้ว: {path}",
  addedReadingList: "เพิ่มลงรายการอ่านแล้ว",
  mediaCopied: "คัดลอกสื่อแล้ว: {count}",
  resourcesCopied: "คัดลอกทรัพยากรแล้ว",
  sourceCopied: "คัดลอกซอร์สแล้ว",
  consoleCopied: "คัดลอกคอนโซลแล้ว",
  cacheCleared: "ล้างแคชแล้ว",
  browsingDataCleared: "ล้างข้อมูลการเรียกดูแล้ว",
  translatePageTo: "แปลหน้าเป็น...",
  newObsidianTab: "แท็บ Obsidian ใหม่",
  address: "ที่อยู่",
  webResultsTab: "เว็บ",
  imageResultsTab: "รูปภาพ",
  videoResultsTab: "วิดีโอ",
  academicTab: "วิชาการ",
  dictionaryTab: "พจนานุกรม",
  mapsTab: "แผนที่",
  moreTab: "เพิ่มเติม",
  aboutResults: "ประมาณ {count} ผลลัพธ์",
  learnMoreAbout: "เรียนรู้เพิ่มเติมเกี่ยวกับ {query}",
  webNotePlaceholder: "โน้ตเว็บ",
  fallbackEditableNote: "การโหลดหน้าถูกจำกัด; ยังคงชั้นโน้ตแก้ไขได้ไว้",
  loadingValue: "กำลังโหลด: {value}",
  yes: "ใช่",
  no: "ไม่",
  downloadDirectory: "ไดเรกทอรีดาวน์โหลด: {folder}",
  cancipAi: "Cancip AI",
  currentOpen: "เปิดหน้าปัจจุบัน",
  readerExtracting: "กำลังสกัดสรุปหน้า...",
  insertedLink: "แทรกลิงก์แล้ว",
  copiedMarkdownLink: "คัดลอกลิงก์ Markdown แล้ว",
  noteDrawDisabled: "ปลั๊กอิน NoteDraw ยังไม่เปิดใช้",
  readerNoteNotReady: "โน้ตตัวอ่านยังไม่พร้อม",
  noWebNoteToExport: "ไม่มีโน้ตเว็บให้ส่งออก",
  jsonCopied: "คัดลอก JSON ของ Mobile Webviewer แล้ว",
  clipboardEmpty: "คลิปบอร์ดว่างเปล่า",
  fileMissingPathCopied: "ไม่พบไฟล์ใน vault; คัดลอกเส้นทางแล้ว",
  htmlSaveFailed: "บันทึก HTML ไม่สำเร็จ",
  mhtSaveFailed: "บันทึก MHT ไม่สำเร็จ",
  shareTextCopied: "คัดลอกข้อความแชร์แล้ว",
  downloadFailed: "ดาวน์โหลดล้มเหลว",
  cancipDisabled: "ปลั๊กอิน Cancip ยังไม่เปิดใช้",
  noWebLinkFound: "ไม่พบลิงก์เว็บ",
  bookmarkNoteCreated: "สร้างโน้ตบุ๊กมาร์กแล้ว",
  emptyConsoleDesc: "ยังไม่มีบันทึก การค้นหา ดาวน์โหลด การบันทึก และสคริปต์จะแสดงที่นี่",
  pageSource: "ซอร์สหน้า",
  copyReport: "คัดลอกรายงาน",
  reportUrl: "URL รายงาน",
  reportCopied: "คัดลอกรายงานแล้ว",
  urlCopied: "คัดลอก URL แล้ว",
  translatePage: "แปลหน้า",
  noSavedPages: "ไม่มีหน้าที่บันทึกไว้",
  noResourcesFound: "ไม่พบทรัพยากร",
  disabled: "ปิดใช้งาน",
  noMatchingScripts: "ไม่มีสคริปต์ที่จับคู่ได้",
  findInPage: "ค้นหาในหน้า",
  previous: "ก่อนหน้า",
  next: "ถัดไป",
  pageLoadLimited: "การโหลดหน้าถูกจำกัด; ยังคงชั้นโน้ตแก้ไขได้ไว้",
  systemBrowser: "เปิดในเบราว์เซอร์ของระบบ",
  proxyModeActive: "ไซต์ปฏิเสธการฝัง — โหลดหน้าจริงผ่านพร็อกซีในตัว",
  postFormUnsupported: "โหมดพร็อกซียังไม่รองรับการส่งฟอร์มแบบ POST",
  uiLanguage: "ภาษาอินเทอร์เฟซ",
  followObsidian: "ตามภาษา Obsidian",
  homePage: "หน้าแรก",
  searchUrl: "URL ค้นหา",
  openBrowser: "เปิดเบราว์เซอร์",
  settings: "การตั้งค่า",
  more: "เพิ่มเติม",
  search: "ค้นหา",
  searchBing: "ค้นหาด้วย Bing",
  bookmarks: "บุ๊กมาร์ก",
  history: "ประวัติ",
  reading: "รายการอ่าน",
  downloads: "ดาวน์โหลด",
  console: "บันทึก",
  back: "กลับ",
  forward: "ถัดไป",
  reload: "โหลดใหม่",
  home: "หน้าแรก",
  note: "โน้ต",
  web: "เว็บ",
  noteBrowser: "เบราว์เซอร์โน้ต",
  saveMd: "บันทึก MD",
  download: "ดาวน์โหลด",
  open: "เปิด",
  copy: "คัดลอก",
  save: "บันทึก",
  tools: "เครื่องมือ",
  page: "หน้า",
  view: "มุมมอง",
  close: "ปิด",
  translateAction: "แปล",
  qrCode: "QR โค้ด",
  copyLink: "คัดลอกลิงก์",
  copiedLink: "คัดลอกลิงก์แล้ว",
  loading: "กำลังโหลด...",
  searching: "กำลังค้นหา...",
  moreResults: "ผลลัพธ์เพิ่มเติม",
  noEntries: "ไม่มีรายการ",
  reader: "ตัวอ่าน",
  links: "ลิงก์"
});

const UI_TEXT_VI = commonUi({
  clearCookies: "Xóa cookie của trang",
  cookiesCleared: "Đã xóa cookie của trang",
  uiLanguageDesc: "Mặc định theo ngôn ngữ Obsidian/hệ thống. Bạn cũng có thể cố định một ngôn ngữ cho plugin.",
  coreEntry: "Lối vào chính",
  coreEntryDesc: "Trang chủ, tìm kiếm, lối vào trình duyệt và hành vi khi khởi động.",
  homePageDesc: "Trang mặc định được nút trang chủ mở.",
  searchUrlDesc: "Dùng {{query}} làm chỗ đặt cho từ khóa tìm kiếm đã mã hóa.",
  noteBrowserCurrentUrl: "URL hiện tại của trình duyệt ghi chú",
  noteBrowserCurrentUrlDesc: "URL được khôi phục khi mở trình duyệt dạng ghi chú.",
  openBrowserDesc: "Mở nhanh trình duyệt dạng ghi chú từ cài đặt.",
  openOnStartup: "Mở khi khởi động",
  openOnStartupDesc: "Mở trình duyệt ghi chú ở chế độ đọc sau khi bố cục Obsidian sẵn sàng.",
  interfaceRendering: "Giao diện và kết xuất",
  interfaceRenderingDesc: "Kiểm soát thanh công cụ di động, đũa thần NoteDraw, lớp đọc và tỉ lệ trang.",
  compactMobileToolbar: "Thanh công cụ di động gọn",
  compactMobileToolbarDesc: "Dùng điều khiển nhỏ hơn cho màn hình điện thoại.",
  showNoteDrawMagicWand: "Hiện đũa thần NoteDraw",
  showNoteDrawMagicWandDesc: "Hiện nút đũa thần trên các bề mặt Mobile Webviewer khi NoteDraw khả dụng.",
  readerHint: "Gợi ý của trình đọc",
  readerHintDesc: "Hiện gợi ý lớp đọc khi trình duyệt nội bộ kết xuất trang kiểu ghi chú.",
  liveBrowserFirst: "Ưu tiên trình duyệt trực tiếp",
  liveBrowserFirstDesc: "Hiện bề mặt WebView trực tiếp phía trên lớp đọc kiểu ghi chú.",
  frontendMode: "Chế độ tiền cảnh",
  frontendModeDesc: "Tiền cảnh mặc định: ghi chú chỉnh sửa được hoặc trang web đầy đủ.",
  editableNote: "Ghi chú chỉnh sửa được",
  fullWebPage: "Trang web đầy đủ",
  autoSaveWebNotes: "Tự lưu ghi chú web",
  autoSaveWebNotesDesc: "Tự lưu văn bản trình đọc đã sửa và nét vẽ chỉ vào dữ liệu plugin. Dùng Lưu MD để thêm tệp Markdown vào kho.",
  webNoteFolder: "Thư mục ghi chú web",
  webNoteFolderDesc: "Các bản xuất Lưu MD thủ công được lưu tại đây trong kho.",
  pageZoom: "Thu phóng trang",
  pageZoomDesc: "Mức thu phóng mặc định cho các bề mặt trình duyệt trực tiếp.",
  readerFontSize: "Cỡ chữ trình đọc",
  readerFontSizeDesc: "Cỡ chữ của lớp đọc/bộ nhớ đệm.",
  desktopView: "Chế độ máy tính",
  desktopViewDesc: "Dùng bề mặt trình duyệt trực tiếp rộng hơn.",
  userAgent: "User agent",
  userAgentDesc: "Dùng cho các yêu cầu lấy/tìm kiếm/tải nội bộ và bề mặt trình duyệt trực tiếp nơi Obsidian cho phép điều khiển.",
  mobile: "Di động",
  desktop: "Máy tính",
  downloadDesc: "Lưu tệp, HTML, MHT và trang ngoại tuyến.",
  downloadFolder: "Thư mục tải xuống",
  downloadFolderDesc: "Tệp được lưu bởi Thêm > Tải xuống, HTML và MHT.",
  downloadConnections: "Kết nối tải xuống",
  downloadConnectionsDesc: "Kết nối song song theo phạm vi byte khi máy chủ hỗ trợ tải tiếp.",
  browserMode: "Chế độ trình duyệt",
  browserModeDesc: "Các công tắc này ảnh hưởng đến kết xuất nội bộ của Browser View và trình duyệt ghi chú.",
  nightMode: "Chế độ đêm",
  nightModeDesc: "Làm tối khung trình duyệt nội bộ và các bề mặt đọc.",
  eyeProtection: "Bảo vệ mắt",
  eyeProtectionDesc: "Áp dụng tông màu đọc dịu hơn.",
  adBlock: "Chặn quảng cáo",
  adBlockDesc: "Loại bỏ các khung quảng cáo phổ biến khi trang truy cập được.",
  markAds: "Đánh dấu quảng cáo",
  markAdsDesc: "Đánh dấu các khung có khả năng là quảng cáo khi trang truy cập được.",
  incognito: "Ẩn danh",
  incognitoDesc: "Ngừng ghi lịch sử và bộ nhớ đệm trình đọc.",
  disableJavaScript: "Tắt JavaScript",
  disableJavaScriptDesc: "Tải lại trang trực tiếp mà không có allow-scripts trong sandbox.",
  rotateScreen: "Xoay màn hình",
  rotateScreenDesc: "Dùng bề mặt trình duyệt rộng hơn theo kiểu ngang.",
  dataImportExport: "Nhập và xuất dữ liệu",
  dataImportExportDesc: "Dấu trang, danh sách đọc, lịch sử, tải xuống, quy tắc script, ghi chú web và cài đặt chung.",
  universalExport: "Xuất phổ quát",
  universalExportDesc: "Lưu gói JSON di động của Mobile Webviewer vào thư mục tải xuống.",
  exportJson: "Xuất JSON",
  copyJson: "Sao chép JSON",
  universalImport: "Nhập phổ quát",
  universalImportDesc: "Nhập từ bảng nhớp: JSON của Mobile Webviewer, HTML dấu trang phổ thông hoặc các dòng URL. Dữ liệu hiện có được hợp nhất.",
  importClipboard: "Nhập từ bảng nhớp",
  translation: "Dịch",
  translationDesc: "Mặc định theo ngôn ngữ Obsidian, hoặc chọn ngôn ngữ đích cố định.",
  defaultTranslationLanguage: "Ngôn ngữ dịch mặc định",
  defaultTranslationLanguageDesc: "Dùng cho Thêm > Dịch và bộ chọn ngôn ngữ. Theo Obsidian sẽ gắn việc dịch với ngôn ngữ giao diện hiện tại của Obsidian.",
  scriptsReader: "Script và lớp đọc",
  scriptsReaderDesc: "CSS, JavaScript của lớp đọc và quy tắc script khớp URL.",
  readerUserScripts: "Script người dùng cho trình đọc",
  readerUserScriptsDesc: "Áp dụng CSS và JavaScript tùy chỉnh cho lớp đọc nội bộ.",
  readerCss: "CSS trình đọc",
  readerCssDesc: "CSS được chèn vào các trang đọc/bộ nhớ đệm đã kết xuất.",
  readerJavascript: "JavaScript trình đọc",
  readerJavascriptDesc: "Chạy với container, page và hostName.",
  userScriptRules: "Quy tắc script người dùng",
  rulesCount: "Quy tắc ({count})",
  rulesDesc: "CSS và JavaScript khớp URL cho lớp đọc nội bộ.",
  addRule: "Thêm quy tắc",
  ruleName: "Tên quy tắc",
  delete: "Xóa",
  match: "Khớp",
  matchDesc: "Hỗ trợ chuỗi con hoặc ký tự đại diện, ví dụ *://*.example.com/*",
  css: "CSS",
  cssDesc: "Được chèn vào các trang đọc khớp.",
  javascript: "JavaScript",
  javascriptDesc: "Chạy với container, page, hostName và rule.",
  autofill: "Tự điền",
  autofillDesc: "Dùng cho Thêm > Tự điền trang; chỉ điền các trường trống truy cập được.",
  autofillName: "Tên tự điền",
  autofillEmail: "Email tự điền",
  autofillPhone: "Điện thoại tự điền",
  autofillAddress: "Địa chỉ tự điền",
  autofillFieldDesc: "Dùng cho Thêm > Tự điền trang.",
  dataMaintenance: "Bảo trì dữ liệu",
  dataMaintenanceDesc: "Xóa lịch sử duyệt, bộ nhớ đệm trình đọc, tải xuống và nhật ký console.",
  clearHistory: "Xóa lịch sử",
  clearReaderCache: "Xóa bộ nhớ đệm trình đọc",
  clearDownloads: "Xóa tải xuống",
  readingList: "Danh sách đọc",
  clearConsole: "Xóa console",
  clearBrowsingData: "Xóa dữ liệu duyệt web",
  clearBrowsingDataDesc: "Xóa lịch sử, bộ nhớ đệm trình đọc và mục console. Dấu trang, danh sách đọc và tệp được giữ lại.",
  exportBookmarkNote: "Xuất ghi chú dấu trang",
  exportBookmarkNoteDesc: "Tạo ghi chú Markdown chứa các dấu trang hiện tại.",
  clear: "Xóa sạch",
  create: "Tạo",
  savedEntries: "Đã lưu {count} mục.",
  cachedPages: "Đã cache {count} trang.",
  downloadRecords: "Đã lưu {count} bản ghi tải xuống. Tệp không bị xóa.",
  savedPages: "Đã lưu {count} trang.",
  consoleEntries: "{count} mục console.",
  supportCodes: "Mã ủng hộ",
  supportCodesDesc: "Nếu plugin này hữu ích, quét mã để ủng hộ việc bảo trì liên tục.",
  searchOrEnterUrl: "Tìm kiếm hoặc nhập URL",
  go: "Đi",
  closeMore: "Đóng Thêm",
  ready: "Sẵn sàng",
  closePanel: "Đóng bảng",
  bookmark: "Dấu trang",
  saveLink: "Lưu liên kết",
  noReadingListYet: "Chưa có danh sách đọc",
  noConsoleLogs: "Không có nhật ký console",
  searchingBing: "Đang tìm trên Bing...",
  resultsCount: "{count} kết quả",
  loadFailedRetry: "Tải thất bại, thử lại",
  nativeLightHome: "Trang chủ gốc nhẹ",
  readingStatus: "Đang đọc...",
  pageTools: "Công cụ trang",
  doodle: "Nét vẽ",
  closeDoodle: "Đóng nét vẽ",
  editableWebNote: "Ghi chú web chỉnh sửa được",
  autoSavedPlugin: "Đã tự lưu vào plugin",
  saving: "Đang lưu...",
  savedPlugin: "Đã lưu vào plugin",
  savedMarkdown: "Đã lưu vào {path}",
  webNoteSaved: "Ghi chú web đã lưu vào dữ liệu plugin",
  savedTo: "Đã lưu vào {path}",
  bookmarkAdded: "Đã thêm dấu trang",
  bookmarkRemoved: "Đã xóa dấu trang",
  noPreviousPage: "Không có trang trước",
  noNextPage: "Không có trang sau",
  internalBrowserTab: "Thẻ trình duyệt nội bộ",
  refresh: "Làm mới",
  openCancip: "Mở Cancip",
  all: "Tất cả",
  completed: "Hoàn thành",
  failed: "Thất bại",
  today: "Hôm nay",
  latest: "Mới nhất",
  downloadState: "{status} · {progress}%",
  openFile: "Mở",
  copyPath: "Sao chép đường dẫn",
  location: "Vị trí",
  source: "Nguồn",
  cancipDetected: "Đã phát hiện Cancip AI",
  cancipNotEnabled: "Cancip AI chưa được bật",
  cancipDetectedDesc: "Phiên bản {version}; mở bảng AI từ đây.",
  cancipNotEnabledDesc: "Sau khi cài hoặc bật Cancip, Mobile Webviewer có thể cung cấp ngữ cảnh web hiện tại làm lối vào AI.",
  copyCurrentContext: "Sao chép ngữ cảnh web hiện tại",
  sendCurrentToCancip: "Gửi trang hiện tại đến Cancip",
  sentCurrentToCancip: "Đã thêm trang hiện tại vào Cancip",
  cancipContextPrompt: "Dùng ngữ cảnh web này để phân tích, tổ chức, trích dẫn hoặc tạo ghi chú.",
  copiedCancipContext: "Đã sao chép ngữ cảnh Cancip",
  downloadComplete: "Tải xuống hoàn tất: {path}",
  newTab: "Thẻ mới",
  openLink: "Mở liên kết",
  openInNewTab: "Mở trong thẻ mới",
  downloadLink: "Tải liên kết",
  downloadSavedTo: "Tải xuống được lưu tại: {folder}",
  tabs: "Thẻ",
  downloadPage: "Tải xuống ({count})",
  bookmarksCount: "Dấu trang ({count})",
  historyCount: "Lịch sử ({count})",
  readingCount: "Đọc ({count})",
  consoleCount: "Nhật ký ({count})",
  downloadsCount: "Tải xuống ({count})",
  newObTab: "Thẻ OB mới",
  openNoteWeb: "Mở Note Web",
  openInBrowser: "Mở trong trình duyệt",
  share: "Chia sẻ",
  browserStatus: "Trạng thái trình duyệt",
  zoomIn: "Phóng to {value}%",
  zoomOut: "Thu nhỏ",
  mobileVersion: "Phiên bản di động",
  desktopVersion: "Phiên bản máy tính",
  dayMode: "Chế độ ngày",
  closeEyeProtection: "Tắt bảo vệ mắt",
  closeAdBlock: "Tắt chặn quảng cáo",
  adBlocking: "Chặn quảng cáo",
  unmarkAds: "Bỏ đánh dấu quảng cáo",
  closeIncognito: "Tắt ẩn danh",
  exitFullscreen: "Thoát toàn màn hình",
  fullscreen: "Toàn màn hình",
  enableJs: "Bật JS",
  disableJs: "Tắt JS",
  closeLandscape: "Tắt chế độ ngang",
  landscape: "Chế độ ngang",
  fontSize: "Cỡ chữ {value}%",
  downloadFile: "Tải tệp",
  saveHtml: "Lưu HTML",
  saveMht: "Lưu MHT",
  offlinePage: "Trang ngoại tuyến",
  desktopShortcut: "Lối tắt máy tính",
  addReadingList: "Thêm vào danh sách đọc",
  autofillPage: "Tự điền trang",
  scriptsCount: "Script ({count})",
  mediaSniff: "Dò phương tiện",
  pageAssets: "Tài nguyên trang",
  copySource: "Sao chép mã nguồn",
  viewSource: "Xem mã nguồn",
  readAloud: "Đọc to",
  report: "Báo cáo",
  copyLogs: "Sao chép nhật ký",
  clearCache: "Xóa bộ nhớ đệm ({count})",
  siteSettings: "Cài đặt trang",
  toolStatus: "Trạng thái công cụ",
  clearBrowsingDataAction: "Xóa dữ liệu duyệt web",
  runningAction: "Đang chạy: {label}",
  completedAction: "Hoàn thành: {label}",
  failedAction: "{label} thất bại: {message}",
  downloadFinished: "Tải xuống xong: {path}",
  saved: "Đã lưu: {path}",
  addedReadingList: "Đã thêm vào danh sách đọc",
  mediaCopied: "Đã sao chép phương tiện: {count}",
  resourcesCopied: "Đã sao chép tài nguyên",
  sourceCopied: "Đã sao chép mã nguồn",
  consoleCopied: "Đã sao chép console",
  cacheCleared: "Đã xóa bộ nhớ đệm",
  browsingDataCleared: "Đã xóa dữ liệu duyệt web",
  translatePageTo: "Dịch trang sang...",
  newObsidianTab: "Thẻ Obsidian mới",
  address: "Địa chỉ",
  webResultsTab: "Web",
  imageResultsTab: "Hình ảnh",
  videoResultsTab: "Video",
  academicTab: "Học thuật",
  dictionaryTab: "Từ điển",
  mapsTab: "Bản đồ",
  moreTab: "Thêm",
  aboutResults: "Khoảng {count} kết quả",
  learnMoreAbout: "Tìm hiểu thêm về {query}",
  webNotePlaceholder: "Ghi chú web",
  fallbackEditableNote: "Tải trang bị giới hạn; giữ lại lớp ghi chú chỉnh sửa được.",
  loadingValue: "Đang tải: {value}",
  yes: "Có",
  no: "Không",
  downloadDirectory: "Thư mục tải xuống: {folder}",
  cancipAi: "Cancip AI",
  currentOpen: "Mở trang hiện tại",
  readerExtracting: "Đang trích xuất tóm tắt trang...",
  insertedLink: "Đã chèn liên kết",
  copiedMarkdownLink: "Đã sao chép liên kết Markdown",
  noteDrawDisabled: "Plugin NoteDraw chưa được bật.",
  readerNoteNotReady: "Ghi chú trình đọc chưa sẵn sàng",
  noWebNoteToExport: "Không có ghi chú web để xuất",
  jsonCopied: "Đã sao chép JSON của Mobile Webviewer",
  clipboardEmpty: "Bảng nhớp trống",
  fileMissingPathCopied: "Không tìm thấy tệp trong kho; đã sao chép đường dẫn",
  htmlSaveFailed: "Lưu HTML thất bại",
  mhtSaveFailed: "Lưu MHT thất bại",
  shareTextCopied: "Đã sao chép văn bản chia sẻ",
  downloadFailed: "Tải xuống thất bại",
  cancipDisabled: "Plugin Cancip chưa được bật",
  noWebLinkFound: "Không tìm thấy liên kết web",
  bookmarkNoteCreated: "Đã tạo ghi chú dấu trang",
  emptyConsoleDesc: "Chưa có nhật ký. Tìm kiếm, tải xuống, lưu và script sẽ xuất hiện tại đây.",
  pageSource: "Mã nguồn trang",
  copyReport: "Sao chép báo cáo",
  reportUrl: "URL báo cáo",
  reportCopied: "Đã sao chép báo cáo",
  urlCopied: "Đã sao chép URL",
  translatePage: "Dịch trang",
  noSavedPages: "Không có trang đã lưu",
  noResourcesFound: "Không tìm thấy tài nguyên",
  disabled: "Đã tắt",
  noMatchingScripts: "Không có script khớp",
  findInPage: "Tìm trong trang",
  previous: "Trước",
  next: "Sau",
  pageLoadLimited: "Tải trang bị giới hạn; giữ lại lớp ghi chú chỉnh sửa được.",
  systemBrowser: "Mở bằng trình duyệt hệ thống",
  proxyModeActive: "Trang từ chối nhúng — đã tải trang thật qua proxy tích hợp",
  postFormUnsupported: "Chế độ proxy không hỗ trợ gửi biểu mẫu POST",
  uiLanguage: "Ngôn ngữ giao diện",
  followObsidian: "Theo ngôn ngữ Obsidian",
  homePage: "Trang chủ",
  searchUrl: "URL tìm kiếm",
  openBrowser: "Mở trình duyệt",
  settings: "Cài đặt",
  more: "Thêm",
  search: "Tìm kiếm",
  searchBing: "Tìm bằng Bing",
  bookmarks: "Dấu trang",
  history: "Lịch sử",
  reading: "Danh sách đọc",
  downloads: "Tải xuống",
  console: "Nhật ký",
  back: "Quay lại",
  forward: "Tiếp",
  reload: "Tải lại",
  home: "Trang chủ",
  note: "Ghi chú",
  web: "Web",
  noteBrowser: "Trình duyệt ghi chú",
  saveMd: "Lưu MD",
  download: "Tải xuống",
  open: "Mở",
  copy: "Sao chép",
  save: "Lưu",
  tools: "Công cụ",
  page: "Trang",
  view: "Xem",
  close: "Đóng",
  translateAction: "Dịch",
  qrCode: "Mã QR",
  copyLink: "Sao chép liên kết",
  copiedLink: "Đã sao chép liên kết",
  loading: "Đang tải...",
  searching: "Đang tìm...",
  moreResults: "Thêm kết quả",
  noEntries: "Không có mục",
  noDownloadsYet: "Chưa có tải xuống",
  noHistoryYet: "Chưa có lịch sử",
  noBookmarksYet: "Chưa có dấu trang",
  addBookmark: "Thêm dấu trang",
  removeBookmark: "Xóa dấu trang",
  reader: "Trình đọc",
  links: "Liên kết"
});

const UI_DICTIONARIES: Record<string, UiDictionary> = {
  en: UI_TEXT_EN,
  "zh-Hans": UI_TEXT_ZH_HANS,
  "zh-Hant": UI_TEXT_ZH_HANT,
  ug: UI_TEXT_UG,
  ar: UI_TEXT_AR,
  ru: UI_TEXT_RU,
  tr: UI_TEXT_TR,
  ja: UI_TEXT_JA,
  ko: UI_TEXT_KO,
  fr: UI_TEXT_FR,
  de: UI_TEXT_DE,
  es: UI_TEXT_ES,
  pt: UI_TEXT_PT,
  it: UI_TEXT_IT,
  hi: UI_TEXT_HI,
  fa: UI_TEXT_FA,
  ur: UI_TEXT_UR,
  kk: UI_TEXT_KK,
  ky: UI_TEXT_KY,
  uz: UI_TEXT_UZ,
  id: UI_TEXT_ID,
  ms: UI_TEXT_MS,
  th: UI_TEXT_TH,
  vi: UI_TEXT_VI
};

interface MwvCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  secure: boolean;
  hostOnly: boolean;
}

interface MobileWebviewerSettings {
  homeUrl: string;
  searchUrl: string;
  uiLanguage: string;
  openOnStartup: boolean;
  noteBrowserStartupDefaultVersion?: string;
  noteDrawLegacyWebviewerMigrationVersion: number;
  compactToolbar: boolean;
  showReaderHint: boolean;
  showFloatingWand: boolean;
  noteBrowserUrl: string;
  noteBrowserBack: string[];
  noteBrowserForward: string[];
  liveBrowserFirst: boolean;
  browserFrontendMode: "note" | "web" | "split";
  autoSaveWebNotes: boolean;
  webNoteFolder: string;
  userScriptsEnabled: boolean;
  readerUserStyle: string;
  readerUserScript: string;
  userScriptRules: UserScriptRule[];
  autofillName: string;
  autofillEmail: string;
  autofillPhone: string;
  autofillAddress: string;
  pageZoom: number;
  desktopMode: boolean;
  nightMode: boolean;
  noImageMode: boolean;
  eyeProtectionMode: boolean;
  adBlockEnabled: boolean;
  markAdsEnabled: boolean;
  incognitoMode: boolean;
  fullScreenMode: boolean;
  jsDisabled: boolean;
  rotatedMode: boolean;
  readerFontScale: number;
  userAgentMode: "mobile" | "desktop";
  translateTarget: string;
  downloadFolder: string;
  downloadConnections: number;
  browserTabs: BrowserTab[];
  activeBrowserTabId: string;
  history: WebEntry[];
  bookmarks: WebEntry[];
  readingList: WebEntry[];
  pageCache: PageCacheEntry[];
  webNotes: WebNoteEntry[];
  consoleEntries: BrowserConsoleEntry[];
  downloads: DownloadEntry[];
  cookieJar: Record<string, MwvCookie>;
  proxyStorage: Record<string, Record<string, string>>;
}

const PORTABLE_SETTING_KEYS = [
  "homeUrl",
  "searchUrl",
  "uiLanguage",
  "openOnStartup",
  "compactToolbar",
  "showReaderHint",
  "showFloatingWand",
  "noteBrowserUrl",
  "liveBrowserFirst",
  "browserFrontendMode",
  "autoSaveWebNotes",
  "webNoteFolder",
  "userScriptsEnabled",
  "readerUserStyle",
  "readerUserScript",
  "autofillName",
  "autofillEmail",
  "autofillPhone",
  "autofillAddress",
  "pageZoom",
  "desktopMode",
  "nightMode",
  "eyeProtectionMode",
  "adBlockEnabled",
  "markAdsEnabled",
  "incognitoMode",
  "fullScreenMode",
  "jsDisabled",
  "rotatedMode",
  "readerFontScale",
  "userAgentMode",
  "translateTarget",
  "downloadFolder",
  "downloadConnections"
] as const;

interface MobileWebviewerPortableData {
  type: "mobile-webviewer-data";
  version: string;
  exportedAt: string;
  settings: Partial<MobileWebviewerSettings>;
  bookmarks: WebEntry[];
  readingList: WebEntry[];
  history: WebEntry[];
  downloads: DownloadEntry[];
  userScriptRules: UserScriptRule[];
  webNotes: WebNoteEntry[];
}

interface PortableImportPayload {
  settings: Partial<MobileWebviewerSettings>;
  bookmarks: WebEntry[];
  readingList: WebEntry[];
  history: WebEntry[];
  downloads: DownloadEntry[];
  userScriptRules: UserScriptRule[];
  webNotes: WebNoteEntry[];
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  imageUrl?: string;
}

interface NotePage {
  title: string;
  url: string;
  byline: string;
  content: string;
  excerpt: string;
  images: string[];
  links: SearchResult[];
}

interface PageCacheEntry extends NotePage {
  cachedAt: number;
}

interface BrowserConsoleEntry {
  level: "info" | "warn" | "error";
  message: string;
  time: number;
  url?: string;
}

interface ElectronWebviewElement extends HTMLElement {
  _mwvReady?: boolean;
  _mwvDestroyed?: boolean;
  _mwvDispose?: () => void;
  src: string;
  loadURL?: (url: string) => void;
  reload?: () => void;
  stop?: () => void;
  goBack?: () => void;
  goForward?: () => void;
  canGoBack?: () => boolean;
  canGoForward?: () => boolean;
  getURL?: () => string;
  getTitle?: () => string;
  findInPage?: (text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }) => number;
  stopFindInPage?: (action: "clearSelection" | "keepSelection" | "activateSelection") => void;
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
  setZoomFactor?: (factor: number) => void;
  setUserAgent?: (userAgent: string) => void;
  openDevTools?: () => void;
  getWebContentsId?: () => number;
  isLoading?: () => boolean;
  _mwvRawElementEditorEnabled?: boolean;
}

type BrowserSurfaceElement = HTMLIFrameElement | ElectronWebviewElement;

interface BrowserSurfaceCallbacks {
  /** Keep the guest page completely untouched: no bridge, filters, CSS, or zoom. */
  raw?: boolean;
  onReady?: () => void | Promise<void>;
  onNavigate?: (url: string) => void | Promise<void>;
  onTitle?: (title: string) => void | Promise<void>;
  onFail?: (message: string, url?: string) => void | Promise<void>;
  onConsole?: (level: BrowserConsoleEntry["level"], message: string, url?: string) => void | Promise<void>;
  onNewWindow?: (url: string) => void | Promise<void>;
  onLoading?: (loading: boolean, url?: string) => void | Promise<void>;
  onFavicon?: (url: string) => void | Promise<void>;
  onDownloadCandidate?: (url: string) => void | Promise<void>;
  onContextLink?: (url: string, title?: string) => void | Promise<void>;
  onWebNotePatch?: (patch: BrowserWebNotePatch) => void | Promise<void>;
}

interface BrowserWebNotePatch {
  url: string;
  title?: string;
  noteHtml?: string;
  noteText?: string;
  doodleSvg?: string;
  pageHtml?: string;
  pageText?: string;
  noteEdited?: boolean;
  doodleEdited?: boolean;
  pageEdited?: boolean;
  webEdit?: BrowserWebTextEdit;
}

interface WebNotePanelElement extends HTMLElement {
  _mwvFinishDoodle?: () => void;
  _mwvFlushWebNote?: () => void | Promise<void>;
  _mwvFlushTimer?: number;
}

interface MobileWebviewerEmbedElement extends HTMLElement {
  _mwvChromeObserver?: MutationObserver;
  _mwvChromeWatchTimer?: number;
  _mwvChromeHeartbeatTimer?: number;
}

interface NoteDrawControllerLike {
  active?: boolean;
  buttonLongPressed?: boolean;
  suppressNextButtonClick?: boolean;
  previewEl?: HTMLElement;
  button?: HTMLElement;
  file?: NoteDrawFileLike;
  plugin?: {
    setInteractionController?: (controller: NoteDrawControllerLike) => void;
  };
  surfaceType?: string;
  allowTextEdit?: boolean;
  toolMode?: string;
  currentEditor?: HTMLElement | null;
  toolbar?: HTMLElement | null;
  formatToolbar?: HTMLElement | null;
  palettePanel?: HTMLElement | null;
  brushPanel?: HTMLElement | null;
  textPanel?: HTMLElement | null;
  selectionMenu?: HTMLElement | null;
  canvas?: HTMLElement | null;
  drawingData?: NoteDrawDrawingDataLike;
  createFormatToolbar?: () => void;
  syncFloatingControlClasses?: () => void;
  ensureDrawingsLoaded?: () => Promise<void>;
  setEditMarkdownMode?: () => void;
  setToolFromApi?: (tool: string, options?: Record<string, unknown>) => boolean;
  toggleSelectMode?: () => void;
  positionFormatToolbar?: () => void;
  applyWebEdits?: () => void;
  resizeCanvas?: () => void;
  render?: () => void;
  setFile?: (file?: { path?: string; name?: string; extension?: string }) => Promise<void>;
  toggle?: () => void | Promise<void>;
  onButtonClick?: (event?: Event) => void | Promise<void>;
  onButtonPointerDown?: (event?: Event) => void | Promise<void>;
  onButtonPointerUp?: (event?: Event) => void | Promise<void>;
  onButtonTouchEnd?: (event?: Event) => void | Promise<void>;
  onButtonContextMenu?: (event?: Event) => void | Promise<void>;
  scheduleLayoutRefresh?: () => void;
  updateFloatingControlsPosition?: () => void;
  destroy?: () => void;
  _mwvNoteWebElementSelectButton?: HTMLButtonElement;
  _mwvNoteWebElementSurface?: HTMLElement;
}

interface NoteDrawFileLike {
  path?: string;
  name?: string;
  extension?: string;
}

interface NoteDrawDrawingDataLike {
  sourcePath?: string;
  visible?: boolean;
  strokes?: unknown[];
  webEdits?: unknown[];
  updatedAt?: string | null;
  [key: string]: unknown;
}

interface NoteDrawButtonElement extends HTMLElement {
  _noteDrawController?: NoteDrawControllerLike;
  _mwvNoteDrawBoundController?: NoteDrawControllerLike;
  _mwvNoteDrawBound?: boolean;
  _mwvNoteDrawLastTouchMs?: number;
  _mwvNoteWebWandProxy?: boolean;
  _mwvNoteWebWandBound?: boolean;
  _mwvNoteWebWandSurface?: HTMLElement;
}

interface NoteWebElementToolbar extends HTMLElement {
  _mwvNoteWebElementSurface?: HTMLElement;
}

interface ObsidianOpenLink {
  vault: string;
  file: string;
  heading: string;
  block: string;
}

interface LocalNoteEmbedElement extends HTMLElement {
  _mwvMarkdownComponent?: Component;
}

interface NoteDrawSurfaceElement extends HTMLElement {
  _noteDrawController?: NoteDrawControllerLike;
}

interface NoteDrawWindowApi {
  getActiveController?: () => NoteDrawControllerLike | null;
}

interface NoteDrawPluginLike {
  syncWebviewControllers?: () => void;
  syncRenderedMarkdownAnnotations?: () => void;
  syncSourceControllers?: () => void;
  syncMarkdownControllerModes?: () => void;
  syncEmbeddedMarkdownControllers?: () => void;
  webviewControllers?: Map<HTMLElement, NoteDrawControllerLike>;
  drawingPathForFile?: (file?: NoteDrawFileLike) => string;
  writeDrawings?: (file?: NoteDrawFileLike, data?: unknown) => Promise<void>;
  scheduleDrawingSave?: (file?: NoteDrawFileLike, data?: unknown) => void;
  api?: {
    readDrawings?: (file?: NoteDrawFileLike) => Promise<NoteDrawDrawingDataLike>;
    writeDrawings?: (file?: NoteDrawFileLike, data?: unknown) => Promise<NoteDrawDrawingDataLike>;
  };
}

interface MobileWebviewerSyntheticEvent extends Event {
  _mwvSyntheticWebNoteSave?: boolean;
}

interface NoteBrowserNativeBinding {
  leaf: WorkspaceLeaf;
  view: {
    addAction?: (icon: IconName, title: string, callback: (evt: MouseEvent) => any) => HTMLElement;
    onPaneMenu?: (menu: Menu, source: string) => any;
    getState?: () => Record<string, unknown>;
    setState?: (state: Record<string, unknown>, result?: unknown) => Promise<void>;
  };
  modeAction?: HTMLElement;
  hiddenEditButtons: HTMLElement[];
  navButtons: Array<{
    element: HTMLElement;
    direction: "back" | "forward";
    handler: (event: Event) => void;
    originalDisabled: boolean;
  }>;
  originalPaneMenu?: (menu: Menu, source: string) => any;
  guardedPaneMenu?: (menu: Menu, source: string) => any;
  originalSetState?: (state: Record<string, unknown>, result?: unknown) => Promise<void>;
  guardedSetState?: (state: Record<string, unknown>, result?: unknown) => Promise<void>;
}

const DEFAULT_SETTINGS: MobileWebviewerSettings = {
  homeUrl: DEFAULT_HOME,
  searchUrl: DEFAULT_SEARCH,
  uiLanguage: DEFAULT_UI_LANGUAGE,
  openOnStartup: false,
  noteDrawLegacyWebviewerMigrationVersion: 0,
  compactToolbar: true,
  showReaderHint: true,
  showFloatingWand: true,
  noteBrowserUrl: DEFAULT_HOME,
  noteBrowserBack: [],
  noteBrowserForward: [],
  liveBrowserFirst: true,
  browserFrontendMode: "note",
  autoSaveWebNotes: true,
  webNoteFolder: DEFAULT_WEB_NOTE_FOLDER,
  userScriptsEnabled: true,
  readerUserStyle: "",
  readerUserScript: "",
  userScriptRules: [],
  autofillName: "",
  autofillEmail: "",
  autofillPhone: "",
  autofillAddress: "",
  pageZoom: 100,
  desktopMode: false,
  nightMode: false,
  noImageMode: false,
  eyeProtectionMode: false,
  adBlockEnabled: true,
  markAdsEnabled: false,
  incognitoMode: false,
  fullScreenMode: false,
  jsDisabled: false,
  rotatedMode: false,
  readerFontScale: 100,
  userAgentMode: "mobile",
  translateTarget: DEFAULT_TRANSLATE_TARGET,
  downloadFolder: DEFAULT_DOWNLOAD_FOLDER,
  downloadConnections: DEFAULT_DOWNLOAD_CONNECTIONS,
  browserTabs: [],
  activeBrowserTabId: "",
  history: [],
  readingList: [],
  pageCache: [],
  webNotes: [],
  consoleEntries: [],
  downloads: [],
  bookmarks: [],
  cookieJar: {},
  proxyStorage: {}
};

function normalizeInput(input: string, searchUrl: string): string {
  const value = input.trim();
  if (!value) return DEFAULT_HOME;

  if (isInternalUtilityUrl(value)) {
    return value;
  }

  if (/^(https?:\/\/|file:\/\/|obsidian:\/\/)/i.test(value)) {
    return value;
  }

  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(value)) {
    return `https://${value}`;
  }

  const encoded = encodeURIComponent(value);
  return searchUrl.includes("{{query}}")
    ? searchUrl.replace("{{query}}", encoded)
    : `${searchUrl}${encoded}`;
}

function parseObsidianOpenLink(input: string | undefined): ObsidianOpenLink | null {
  const value = input?.trim() ?? "";
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol.toLowerCase() !== "obsidian:" || parsed.hostname.toLowerCase() !== "open") return null;
    const file = parsed.searchParams.get("file")?.trim() ?? "";
    if (!file) return null;
    return {
      vault: parsed.searchParams.get("vault")?.trim() ?? "",
      file,
      heading: parsed.searchParams.get("heading")?.trim() ?? "",
      block: parsed.searchParams.get("block")?.trim() ?? ""
    };
  } catch {
    return null;
  }
}

function isLegacyObsidianFileUrl(input: string | undefined): boolean {
  const value = input?.trim() ?? "";
  if (!value) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol.toLowerCase() !== "http:" || parsed.hostname.toLowerCase() !== "localhost") return false;
    return /\.(?:md|markdown|pdf|docx?|xlsx?|pptx?|csv|txt|png|jpe?g|gif|webp|svg|mp4|mp3)(?:$|[?#])/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function equivalentEmbedUrl(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return left === right;
  try {
    const normalize = (value: string) => {
      const parsed = new URL(value);
      parsed.pathname = parsed.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
      return parsed.toString();
    };
    return normalize(left) === normalize(right);
  } catch {
    return left.replace(/\/$/, "") === right.replace(/\/$/, "");
  }
}

function isInternalUtilityUrl(url: string | undefined): boolean {
  if (!url) return false;
  const clean = url.trim().toLowerCase();
  if (!clean.startsWith(MWV_INTERNAL_SCHEME)) return false;
  return UTILITY_PAGE_KINDS.includes(clean.slice(MWV_INTERNAL_SCHEME.length).split(/[/?#]/)[0] as UtilityPageKind);
}

function internalUtilityKind(url: string | undefined): UtilityPageKind | null {
  if (!isInternalUtilityUrl(url)) return null;
  const kind = url!.trim().toLowerCase().slice(MWV_INTERNAL_SCHEME.length).split(/[/?#]/)[0] as UtilityPageKind;
  return UTILITY_PAGE_KINDS.includes(kind) ? kind : null;
}

function internalUtilityContextUrl(url: string | undefined): string {
  if (!url || !isInternalUtilityUrl(url)) return "";
  try {
    const parsed = new URL(url.replace(/^mwv:\/\//i, "https://mwv.local/"));
    const context = parsed.searchParams.get("url") || "";
    return /^https?:\/\//i.test(context) ? context : "";
  } catch {
    const match = url.match(/[?&]url=([^&#]+)/i);
    if (!match?.[1]) return "";
    try {
      const context = decodeURIComponent(match[1]);
      return /^https?:\/\//i.test(context) ? context : "";
    } catch {
      return "";
    }
  }
}

interface RuntimeProcessLike {
  versions?: {
    chrome?: string;
    electron?: string;
  };
}

interface ObsidianSettingsLike {
  open?: () => void;
  openTabById?: (id: string) => void;
}

interface AppWithRuntimePlugins extends App {
  plugins?: {
    commands?: {
      executeCommandById?: (id: string) => boolean;
      commands?: Record<string, { name?: string }>;
    };
    plugins?: Record<string, unknown>;
  };
}

interface AppWithSettings extends App {
  setting?: ObsidianSettingsLike;
}

interface BrowserWindowWithProcess extends Window {
  process?: RuntimeProcessLike;
}

interface WindowWithFind extends Window {
  find?: (
    searchString: string,
    caseSensitive?: boolean,
    backwards?: boolean,
    wrapAround?: boolean,
    wholeWord?: boolean,
    searchInFrames?: boolean,
    showDialog?: boolean
  ) => boolean;
}

interface CancipPluginLike {
  activateView?: () => Promise<void> | void;
  receiveExternalContext?: (input: CancipExternalContextInput) => Promise<unknown> | unknown;
  api?: {
    receiveExternalContext?: (input: CancipExternalContextInput) => Promise<unknown> | unknown;
  };
}

interface CancipExternalContextInput {
  source: "mobile-webviewer";
  label: string;
  content: string;
  url?: string;
  title?: string;
  prompt?: string;
  submit?: boolean;
  reveal?: boolean;
  focus?: boolean;
  metadata?: Record<string, unknown>;
}

interface MobileWebviewerContextOptions {
  includeContent?: boolean;
  includeHtml?: boolean;
  includeSelection?: boolean;
  refresh?: boolean;
  maxChars?: number;
}

interface MobileWebviewerContext {
  apiVersion: string;
  pluginVersion: string;
  url: string;
  title: string;
  tabId: string;
  source: "view" | "embed" | "settings";
  selectedText: string;
  byline: string;
  excerpt: string;
  content: string;
  html: string;
  images: string[];
  links: SearchResult[];
  capturedAt: number;
}

interface MobileWebviewerApiEvent {
  type: "navigate" | "tab-change" | "tab-close" | "bookmark-change" | "reading-list-change";
  time: number;
  url?: string;
  title?: string;
  tabId?: string;
  detail?: Record<string, unknown>;
}

type MobileWebviewerApiListener = (event: MobileWebviewerApiEvent) => void;

interface MobileWebviewerApi {
  apiVersion: string;
  getCapabilities: () => Record<string, unknown>;
  getStatus: () => Record<string, unknown>;
  getCurrentContext: (options?: MobileWebviewerContextOptions) => Promise<MobileWebviewerContext>;
  getSelection: () => Promise<{ text: string; url: string; title: string }>;
  readPage: (input?: string | ({ url?: string } & MobileWebviewerContextOptions)) => Promise<MobileWebviewerContext>;
  open: (input?: string | { url?: string; newTab?: boolean; mode?: "view" | "note" }) => Promise<Record<string, unknown>>;
  listTabs: () => MobileWebviewerTabSummary[];
  newTab: (input?: string | { url?: string }) => Promise<MobileWebviewerTabSummary>;
  switchTab: (input: string | { id: string }) => Promise<MobileWebviewerTabSummary>;
  closeTab: (input: string | { id: string }) => Promise<{ closed: string; activeTabId: string }>;
  toggleBookmark: (input?: { url?: string; title?: string }) => Promise<{ bookmarked: boolean; url: string; title: string }>;
  addToReadingList: (input?: { url?: string; title?: string }) => Promise<{ added: boolean; url: string; title: string }>;
  sendToCancip: (input?: { prompt?: string; submit?: boolean; reveal?: boolean; focus?: boolean; maxChars?: number }) => Promise<Record<string, unknown>>;
  subscribe: (listener: MobileWebviewerApiListener) => () => void;
}

interface AutofillProfile {
  name: string;
  email: string;
  phone: string;
  address: string;
}
function utilityPageUrl(kind: UtilityPageKind, contextUrl = ""): string {
  const base = `${MWV_INTERNAL_SCHEME}${kind}`;
  return /^https?:\/\//i.test(contextUrl) ? `${base}?url=${encodeURIComponent(contextUrl)}` : base;
}

function utilityPageTitle(kind: UtilityPageKind): string {
  switch (kind) {
    case "bookmarks":
      return "Bookmarks";
    case "history":
      return "History";
    case "reading":
      return "Reading List";
    case "downloads":
      return "Downloads";
    case "console":
      return "Console";
    case "cancip":
      return "Cancip AI";
  }
}

function utilityPageTitleKey(kind: UtilityPageKind): UiTextKey {
  switch (kind) {
    case "bookmarks":
      return "bookmarks";
    case "history":
      return "history";
    case "reading":
      return "readingList";
    case "downloads":
      return "downloads";
    case "console":
      return "console";
    case "cancip":
      return "cancipAi";
  }
}

function hostName(url: string): string {
  const utilityKind = internalUtilityKind(url);
  if (utilityKind) return utilityPageTitle(utilityKind);
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function uniqueEntries(entries: WebEntry[], max: number): WebEntry[] {
  const seen = new Set<string>();
  const result: WebEntry[] = [];
  for (const entry of entries) {
    const key = entry.url.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
    if (result.length >= max) break;
  }
  return result;
}

function normalizeWebEntry(value: unknown, fallbackTitle = ""): WebEntry | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<WebEntry>;
  const url = typeof item.url === "string" ? normalizeInput(item.url, DEFAULT_SEARCH) : "";
  if (!/^https?:\/\//i.test(url) && !isInternalUtilityUrl(url)) return null;
  return {
    title: typeof item.title === "string" && item.title.trim() ? item.title.trim().slice(0, 180) : fallbackTitle || hostName(url),
    url,
    time: typeof item.time === "number" && Number.isFinite(item.time) ? item.time : Date.now()
  };
}

function mergeWebEntries(existing: WebEntry[], incoming: WebEntry[], max: number): WebEntry[] {
  const map = new Map<string, WebEntry>();
  for (const entry of [...incoming, ...existing]) {
    const normalized = normalizeWebEntry(entry);
    if (!normalized) continue;
    const current = map.get(normalized.url);
    if (!current || normalized.time >= current.time) {
      map.set(normalized.url, normalized);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.time - a.time).slice(0, max);
}

function mergeUserScriptRules(existing: UserScriptRule[], incoming: UserScriptRule[]): UserScriptRule[] {
  const map = new Map<string, UserScriptRule>();
  for (const rule of [...existing, ...incoming]) {
    if (!rule || typeof rule !== "object") continue;
    const id = typeof rule.id === "string" && rule.id ? rule.id : `${rule.name || "script"}-${simpleHash(`${rule.match || ""}${rule.css || ""}${rule.js || ""}`)}`;
    map.set(id, {
      id,
      name: typeof rule.name === "string" && rule.name.trim() ? rule.name.trim().slice(0, 80) : "脚本",
      match: typeof rule.match === "string" && rule.match.trim() ? rule.match.trim() : "*://*/*",
      enabled: typeof rule.enabled === "boolean" ? rule.enabled : true,
      css: typeof rule.css === "string" ? rule.css : "",
      js: typeof rule.js === "string" ? rule.js : "",
      runAt: "reader",
      time: typeof rule.time === "number" ? rule.time : Date.now()
    });
  }
  return Array.from(map.values()).sort((a, b) => b.time - a.time).slice(0, 80);
}

function mergeDownloads(existing: DownloadEntry[], incoming: DownloadEntry[]): DownloadEntry[] {
  const map = new Map<string, DownloadEntry>();
  for (const entry of [...incoming, ...existing]) {
    if (!entry || typeof entry.url !== "string") continue;
    const id = typeof entry.id === "string" && entry.id ? entry.id : `dl-${simpleHash(entry.url)}-${simpleHash(entry.path || entry.fileName || "")}`;
    map.set(id, {
      id,
      url: entry.url,
      fileName: typeof entry.fileName === "string" ? entry.fileName : fileNameFromUrl(entry.url),
      path: typeof entry.path === "string" ? normalizePath(entry.path) : "",
      mime: typeof entry.mime === "string" ? entry.mime : "",
      status: ["queued", "downloading", "completed", "error"].includes(entry.status) ? entry.status : "completed",
      format: ["file", "html", "mhtml"].includes(entry.format) ? entry.format : "file",
      bytesReceived: typeof entry.bytesReceived === "number" ? entry.bytesReceived : 0,
      bytesTotal: typeof entry.bytesTotal === "number" ? entry.bytesTotal : 0,
      progress: clampNumber(typeof entry.progress === "number" ? entry.progress : 0, 0, 100),
      connections: clampNumber(typeof entry.connections === "number" ? entry.connections : 1, 1, 8),
      resumable: typeof entry.resumable === "boolean" ? entry.resumable : false,
      message: typeof entry.message === "string" ? entry.message : "",
      time: typeof entry.time === "number" ? entry.time : Date.now()
    });
  }
  return Array.from(map.values()).sort((a, b) => b.time - a.time).slice(0, MAX_DOWNLOADS);
}

function normalizeBrowserWebTextEdits(value: unknown): BrowserWebTextEdit[] {
  if (!Array.isArray(value)) return [];
  const edits = new Map<string, BrowserWebTextEdit>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Partial<BrowserWebTextEdit>;
    const path = typeof item.path === "string" ? item.path.trim().slice(0, 1200) : "";
    const originalText = typeof item.originalText === "string" ? item.originalText.slice(0, 200000) : "";
    const editedText = typeof item.editedText === "string" ? item.editedText.slice(0, 200000) : "";
    if (!path || !originalText || originalText === editedText) continue;
    const normalized: BrowserWebTextEdit = {
      kind: "text",
      path,
      originalText,
      editedText,
      updatedAt: typeof item.updatedAt === "string" && item.updatedAt ? item.updatedAt : new Date().toISOString()
    };
    edits.set(path, normalized);
  }
  return Array.from(edits.values()).slice(-500);
}

function mergeWebNotes(existing: WebNoteEntry[], incoming: WebNoteEntry[]): WebNoteEntry[] {
  const map = new Map<string, WebNoteEntry>();
  for (const entry of [...existing, ...incoming]) {
    if (!entry || typeof entry.url !== "string") continue;
    const id = typeof entry.id === "string" && entry.id ? entry.id : webNoteId(entry.url);
    const normalized: WebNoteEntry = {
      id,
      url: entry.url,
      title: typeof entry.title === "string" && entry.title ? entry.title : hostName(entry.url),
      sourceTitle: typeof entry.sourceTitle === "string" ? entry.sourceTitle : "",
      noteHtml: typeof entry.noteHtml === "string" ? entry.noteHtml : "",
      noteText: typeof entry.noteText === "string" ? entry.noteText : "",
      doodleSvg: typeof entry.doodleSvg === "string" ? entry.doodleSvg : "",
      pageHtml: typeof entry.pageHtml === "string" ? entry.pageHtml : "",
      pageText: typeof entry.pageText === "string" ? entry.pageText : "",
      pageEdits: normalizeBrowserWebTextEdits((entry as Partial<WebNoteEntry>).pageEdits),
      markdownPath: typeof entry.markdownPath === "string" ? normalizePath(entry.markdownPath) : "",
      updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now(),
      createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now()
    };
    const current = map.get(id);
    if (!current || normalized.updatedAt >= current.updatedAt) map.set(id, normalized);
  }
  return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_WEB_NOTES);
}

function parseBookmarkHtml(text: string): WebEntry[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/html");
  const entries: WebEntry[] = [];
  doc.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
    const entry = normalizeWebEntry({
      title: textFromElement(anchor),
      url: anchor.href,
      time: Number(anchor.getAttribute("add_date")) * 1000 || Date.now()
    });
    if (entry) entries.push(entry);
  });
  return entries;
}

function parsePlainUrlList(text: string): WebEntry[] {
  const entries: WebEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/https?:\/\/[^\s<>"')]+/i);
    if (!match) continue;
    const entry = normalizeWebEntry({ title: hostName(match[0]), url: match[0], time: Date.now() });
    if (entry) entries.push(entry);
  }
  return entries;
}

function parsePortableImportText(text: string): PortableImportPayload {
  const fallback = (): PortableImportPayload => {
    const htmlEntries = /<a\s/i.test(text) ? parseBookmarkHtml(text) : [];
    const plainEntries = htmlEntries.length ? [] : parsePlainUrlList(text);
    return {
      settings: {},
      bookmarks: htmlEntries.length ? htmlEntries : plainEntries,
      readingList: [],
      history: [],
      downloads: [],
      userScriptRules: [],
      webNotes: []
    };
  };

  try {
    const parsed = JSON.parse(text) as Partial<MobileWebviewerPortableData> & Partial<MobileWebviewerSettings>;
    const looksPortable = parsed.type === "mobile-webviewer-data" || Array.isArray(parsed.bookmarks) || Array.isArray(parsed.userScriptRules);
    if (!looksPortable) return fallback();
    return {
      settings: parsed.settings && typeof parsed.settings === "object" ? parsed.settings : parsed,
      bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks.map((entry) => normalizeWebEntry(entry)).filter(Boolean) as WebEntry[] : [],
      readingList: Array.isArray(parsed.readingList) ? parsed.readingList.map((entry) => normalizeWebEntry(entry)).filter(Boolean) as WebEntry[] : [],
      history: Array.isArray(parsed.history) ? parsed.history.map((entry) => normalizeWebEntry(entry)).filter(Boolean) as WebEntry[] : [],
      downloads: Array.isArray(parsed.downloads) ? parsed.downloads.filter((entry): entry is DownloadEntry => Boolean(entry && typeof entry.url === "string")) : [],
      userScriptRules: Array.isArray(parsed.userScriptRules) ? parsed.userScriptRules.filter((rule): rule is UserScriptRule => Boolean(rule && typeof rule === "object")) : [],
      webNotes: Array.isArray(parsed.webNotes) ? parsed.webNotes.filter((entry): entry is WebNoteEntry => Boolean(entry && typeof entry.url === "string")) : []
    };
  } catch {
    return fallback();
  }
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function cleanResultUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (/(^|\.)bing\.com$/i.test(parsed.hostname) && parsed.pathname.startsWith("/ck/a")) {
      const direct = parsed.searchParams.get("u");
      if (direct) {
        const stripped = direct.startsWith("a1") ? direct.slice(2) : direct;
        return atob(stripped.replace(/-/g, "+").replace(/_/g, "/"));
      }
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

function absoluteUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

function textFromElement(element: Element | null): string {
  return element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function htmlToText(value: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(value, "text/html");
  return doc.body.textContent?.replace(/\s+/g, " ").trim() ?? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function appendSafeHtml(element: HTMLElement, html: string): void {
  element.empty();
  element.appendChild(sanitizeHTMLToDom(html));
}

function appendSafeDoodleSvg(svg: SVGSVGElement, markup: string): void {
  svg.empty();
  const clean = markup.trim();
  if (!clean) return;
  const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${clean}</svg>`, "image/svg+xml");
  doc.querySelectorAll("path").forEach((source) => {
    const path = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
    for (const attr of ["d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-opacity", "fill-opacity", "opacity", "vector-effect", "transform"]) {
      const value = source.getAttribute(attr);
      if (value) path.setAttribute(attr, value);
    }
    if (path.getAttribute("d")) svg.appendChild(path);
  });
}

function appDocument(): Document {
  return window.activeDocument ?? window.document;
}

type DomConstructorWindow = Window & {
  HTMLElement: typeof HTMLElement;
  HTMLAnchorElement: typeof HTMLAnchorElement;
};

function ownerWindow(value: unknown): DomConstructorWindow | null {
  if (!value || typeof value !== "object" || !("ownerDocument" in value)) return null;
  const doc = (value as Node).ownerDocument;
  return doc?.defaultView as DomConstructorWindow | null;
}

function isHtmlElement(value: unknown): value is HTMLElement {
  const win = ownerWindow(value);
  return Boolean(win?.HTMLElement && value instanceof win.HTMLElement);
}

function isAnchorElement(value: unknown): value is HTMLAnchorElement {
  const win = ownerWindow(value);
  return Boolean(win?.HTMLAnchorElement && value instanceof win.HTMLAnchorElement);
}

function createHostDiv(): HTMLDivElement {
  return appDocument().createElement("div");
}

function runAsync(task: () => Promise<void>): void {
  void task().catch((error) => {
    console.error("[mobile-webviewer] async UI action failed", error);
  });
}

function runActionWithFeedback(
  action: () => void | Promise<void>,
  onDone: () => void,
  onError: (error: unknown) => void,
  onFinally: () => void
): void {
  try {
    const result = action();
    if (result && typeof result.then === "function") {
      void (async () => {
        try {
          await result;
          onDone();
        } catch (error) {
          onError(error);
        } finally {
          onFinally();
        }
      })();
      return;
    }
    onDone();
  } catch (error) {
    onError(error);
  }
  onFinally();
}

function parseJsonStringArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function extractMediaUrlsFromText(text: string): string[] {
  const result: string[] = [];
  const mediaUrlPattern = /https?:\/\/[^\s"'<>]+?\.(?:mp4|m3u8|mp3|m4a|webm|mov|avi|flv)(?:\?[^\s"'<>]*)?/gi;
  let match = mediaUrlPattern.exec(text);
  while (match) {
    result.push(match[0]);
    match = mediaUrlPattern.exec(text);
  }
  return result;
}

function hasAutofillProfileValue(profile: AutofillProfile): boolean {
  return Boolean(profile.name || profile.email || profile.phone || profile.address);
}

function resultTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname
      .split("/")
      .map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      })
      .filter(Boolean)
      .slice(0, 3);
    return [hostName(url), ...parts].join(" › ");
  } catch {
    return url;
  }
}

function looksLikeUrlTitle(title: string, url: string): boolean {
  const clean = title.trim();
  if (!clean) return true;
  const host = hostName(url);
  const compactTitle = clean.replace(/\s+/g, "");
  const compactHost = host.replace(/\s+/g, "");
  return /^https?:\/\//i.test(clean) ||
    clean.includes("http://") ||
    clean.includes("https://") ||
    compactTitle === compactHost ||
    compactTitle.startsWith(`${compactHost}http`);
}

function readableTitleFromSnippet(snippet: string): string {
  const clean = htmlToText(snippet)
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean || /^https?:\/\//i.test(clean)) return "";
  const firstSentence = clean.split(/[。！？.!?]/)[0]?.trim() || clean;
  const title = firstSentence.length > 8 ? firstSentence : clean;
  return shortenTitle(title);
}

function fallbackSearchTitle(url: string, query = "", snippet = ""): string {
  const snippetTitle = readableTitleFromSnippet(snippet);
  if (snippetTitle && !looksLikeUrlTitle(snippetTitle, url)) return snippetTitle;
  const host = hostName(url);
  if (query.trim()) return `${shortenTitle(query.trim())} - ${host}`;
  return resultTitleFromUrl(url);
}

function cleanSearchTitle(rawTitle: string, url: string, snippet = "", query = ""): string {
  const host = hostName(url);
  const directUrl = cleanResultUrl(url);
  let title = htmlToText(rawTitle)
    .replace(/\s+/g, " ")
    .replace(directUrl, " ")
    .replace(url, " ")
    .trim();

  if (looksLikeUrlTitle(title, directUrl)) {
    return fallbackSearchTitle(directUrl, query, snippet);
  }

  const compactTitle = title.replace(/\s+/g, "");
  const compactHost = host.replace(/\s+/g, "");
  if (compactTitle.startsWith(`${compactHost}http`) || compactTitle.includes("http://") || compactTitle.includes("https://")) {
    return fallbackSearchTitle(directUrl, query, snippet);
  }

  return shortenTitle(title);
}

function shortenTitle(title: string): string {
  const withoutTail = title
    .replace(/\s*[-_|]\s*(百度百科|知乎|小红书|Bing|Microsoft|Wikipedia|维基百科).*$/i, "")
    .trim();
  const clean = withoutTail || title;
  return clean.length > 34 ? `${clean.slice(0, 34)}...` : clean;
}

function firstImageFromElement(root: Element, baseUrl: string): string | undefined {
  return imageCandidatesFromDocument(root, baseUrl, 1)[0];
}

function bestSrcsetCandidate(srcset: string): string {
  const candidates = srcset
    .split(",")
    .map((part) => {
      const [url = "", descriptor = ""] = part.trim().split(/\s+/, 2);
      const weight = descriptor.endsWith("w")
        ? Number.parseFloat(descriptor)
        : descriptor.endsWith("x")
          ? Number.parseFloat(descriptor) * 1000
          : 0;
      return { url: url.trim(), weight: Number.isFinite(weight) ? weight : 0 };
    })
    .filter((item) => item.url);
  candidates.sort((a, b) => b.weight - a.weight);
  return candidates[0]?.url ?? "";
}

function cleanImageCandidate(raw: string, baseUrl: string): string {
  const value = raw.trim().replace(/^url\((['"]?)(.*?)\1\)$/i, "$2").trim();
  if (!value || value.startsWith("data:") || value.startsWith("blob:")) return "";
  const absolute = absoluteUrl(value, baseUrl);
  if (!/^https?:\/\//i.test(absolute)) return "";
  if (/\b(1x1|pixel|spacer|blank|transparent)\b/i.test(absolute)) return "";
  return absolute;
}

function imageCandidatesFromDocument(root: ParentNode, baseUrl: string, limit = 12): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const add = (raw: string | null | undefined) => {
    if (!raw || result.length >= limit) return;
    const url = cleanImageCandidate(raw, baseUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    result.push(url);
  };

  root.querySelectorAll<HTMLMetaElement>(
    "meta[property='og:image'], meta[property='og:image:secure_url'], meta[name='twitter:image'], meta[name='twitter:image:src']"
  ).forEach((element) => add(element.getAttribute("content")));
  root.querySelectorAll<HTMLLinkElement>("link[rel~='image_src'][href], link[rel~='preload'][as='image'][href]").forEach((element) => add(element.getAttribute("href")));
  root.querySelectorAll<HTMLSourceElement>("picture source[srcset], source[type^='image/'][srcset]").forEach((element) => add(bestSrcsetCandidate(element.getAttribute("srcset") ?? "")));
  root.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    add(bestSrcsetCandidate(image.getAttribute("srcset") ?? image.getAttribute("data-srcset") ?? ""));
    for (const attr of ["src", "data-src", "data-original", "data-original-src", "data-lazy-src", "data-url", "data-image", "data-img", "data-thumb", "data-thumbnail"]) {
      add(image.getAttribute(attr));
    }
  });
  root.querySelectorAll<HTMLElement>("[style*='background']").forEach((element) => {
    const style = element.getAttribute("style") ?? "";
    const backgroundUrlPattern = /background(?:-image)?\s*:[^;]*url\((['"]?)(.*?)\1\)/gi;
    let match = backgroundUrlPattern.exec(style);
    while (match) {
      add(match[2]);
      match = backgroundUrlPattern.exec(style);
    }
  });
  return result;
}

/* ---------------------------------------------------------------------------
 * Reader extraction: HTML -> structured Markdown.
 * The reader layer should keep the structure a site actually published instead
 * of flattening it into paragraphs. This walks the DOM in document order and
 * preserves heading levels, ordered/unordered/nested lists, task items, GFM
 * tables, fenced code, quotes, figures, definition lists and inline emphasis,
 * while rewriting every link and image against the page URL.
 * ------------------------------------------------------------------------ */

const MD_SKIP_TAGS = new Set([
  "script", "style", "noscript", "template", "svg", "canvas", "iframe",
  "object", "embed", "link", "meta", "base", "head", "title", "colgroup",
  "nav", "footer", "form", "aside", "button", "select", "textarea", "dialog"
]);

const MD_BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "details", "div", "dl", "dd",
  "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3",
  "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre",
  "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul"
]);

/**
 * Page chrome that survives the tag-level filters because sites render it with
 * ordinary `<div>`/`<span>` markup. Kept deliberately conservative: anything
 * that could plausibly carry the article headline, byline or body is absent.
 */
const MD_NOISE_PATTERN = /(^|[-_ ])(toc|table-of-contents|sidebar|side-bar|breadcrumbs?|navbar|navigation|nav-links|navmenu|site-nav|main-nav|sub-nav|advert|advertisement|adsbygoogle|ads|promo|promotion|sponsored|cookie|consent|newsletter|subscribe|social|share|sharing|related|recommend|recommendations?|comments?|pagination|pager|skip-link|visually-hidden|sr-only|screen-reader|screenreader|print-only|hidden-text)([-_ ]|$)/;

const MD_NOISE_ROLES = new Set(["navigation", "complementary", "search", "banner", "contentinfo", "dialog", "alertdialog"]);

const MD_MAX_READER_CHARS = 40000;

function mdIsNoiseElement(element: HTMLElement): boolean {
  if (element.getAttribute("aria-hidden") === "true") return true;
  const role = (element.getAttribute("role") ?? "").trim().toLowerCase();
  if (role && MD_NOISE_ROLES.has(role)) return true;
  const id = (element.id ?? "").toLowerCase();
  if (id && MD_NOISE_PATTERN.test(id)) return true;
  const className = typeof element.className === "string" ? element.className.toLowerCase() : "";
  return !!className && MD_NOISE_PATTERN.test(className);
}

function mdCollapseSpace(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").replace(/\u00a0/g, " ").replace(/ {2,}/g, " ");
}

function mdAbsoluteLink(raw: string | null, baseUrl: string): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  if (value.startsWith("#")) return "";
  if (/^(mailto:|tel:|javascript:|data:|blob:)/i.test(value)) return "";
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return /^https?:\/\//i.test(value) ? value : "";
  }
}

function mdDetectLanguage(element: HTMLElement): string {
  const raw = `${element.className} ${element.getAttribute("data-lang") ?? ""} ${element.getAttribute("data-language") ?? ""}`;
  const match = /(?:language|lang|brush|highlight)[-: ]([a-z0-9+#._-]+)/i.exec(raw);
  return match ? match[1].toLowerCase() : "";
}

function mdFenceFor(code: string): string {
  return code.includes("```") ? "````" : "```";
}

function mdIndentBlock(block: string, prefix: string): string {
  return block
    .split("\n")
    .map((line) => (line.length ? prefix + line : line))
    .join("\n");
}

function mdInlineNodes(nodes: Node[], baseUrl: string): string {
  let out = "";
  for (const child of nodes) {
    if (child.nodeType === 3) {
      out += mdCollapseSpace(child.nodeValue ?? "");
      continue;
    }
    if (child.nodeType !== 1) continue;
    const element = child as HTMLElement;
    const tag = element.tagName.toLowerCase();
    if (MD_SKIP_TAGS.has(tag)) continue;
    if (mdIsNoiseElement(element)) continue;
    if (tag === "br") {
      out += "  \n";
      continue;
    }
    if (tag === "wbr") continue;
    if (tag === "img") {
      const src = mdAbsoluteLink(
        element.getAttribute("src") ??
          element.getAttribute("data-src") ??
          element.getAttribute("data-original") ??
          element.getAttribute("data-lazy-src"),
        baseUrl
      );
      if (!src) continue;
      const alt = mdCollapseSpace(element.getAttribute("alt") ?? element.getAttribute("title") ?? "").trim();
      out += `![${alt}](${src})`;
      continue;
    }
    if (tag === "input") {
      const type = (element.getAttribute("type") ?? "").toLowerCase();
      if (type === "checkbox" || type === "radio") out += element.hasAttribute("checked") ? "[x] " : "[ ] ";
      continue;
    }
    const inner = mdInlineNodes(Array.from(element.childNodes), baseUrl);
    const trimmed = inner.trim();
    switch (tag) {
      case "strong":
      case "b":
        out += trimmed ? `**${trimmed}**` : "";
        break;
      case "em":
      case "i":
      case "cite":
      case "var":
      case "dfn":
        out += trimmed ? `*${trimmed}*` : "";
        break;
      case "del":
      case "s":
      case "strike":
        out += trimmed ? `~~${trimmed}~~` : "";
        break;
      case "mark":
        out += trimmed ? `==${trimmed}==` : "";
        break;
      case "code":
      case "kbd":
      case "samp": {
        const text = (element.textContent ?? "").trim();
        if (!text) break;
        const fence = text.includes("`") ? "``" : "`";
        out += `${fence}${text}${fence}`;
        break;
      }
      case "sup":
        out += trimmed ? `<sup>${trimmed}</sup>` : "";
        break;
      case "sub":
        out += trimmed ? `<sub>${trimmed}</sub>` : "";
        break;
      case "a": {
        const href = mdAbsoluteLink(element.getAttribute("href"), baseUrl);
        if (!trimmed) break;
        out += href && href !== trimmed ? `[${trimmed}](${href})` : trimmed;
        break;
      }
      case "time":
      case "span":
      case "label":
      case "small":
      case "u":
      case "abbr":
      case "q":
      case "bdi":
      case "bdo":
      case "font":
      default:
        out += inner;
        break;
    }
  }
  return out;
}

function mdCodeBlock(pre: HTMLElement): string {
  const code = pre.querySelector<HTMLElement>(":scope > code") ?? pre;
  const language = mdDetectLanguage(code) || mdDetectLanguage(pre);
  const text = (code.textContent ?? "").replace(/^\n+/, "").replace(/\s+$/, "");
  if (!text) return "";
  const fence = mdFenceFor(text);
  return `${fence}${language}\n${text}\n${fence}`;
}

function mdList(list: HTMLElement, baseUrl: string): string {
  const ordered = list.tagName.toLowerCase() === "ol";
  let index = Number.parseInt(list.getAttribute("start") ?? "1", 10);
  if (!Number.isFinite(index) || index < 0) index = 1;
  const lines: string[] = [];
  for (const child of Array.from(list.children)) {
    if (child.tagName.toLowerCase() !== "li") continue;
    const marker = ordered ? `${index++}. ` : "- ";
    const blocks = mdBlocksFromChildren(child, baseUrl);
    if (!blocks.length) {
      lines.push(marker.trimEnd());
      continue;
    }
    let head = blocks[0].replace(/\n+/g, " ");
    const checkbox = child.querySelector<HTMLInputElement>(":scope > input[type='checkbox']");
    if (checkbox) {
      // The checkbox input is emitted as "[x] " by the inline walker, so drop
      // that leading marker before prepending the canonical task-list marker.
      head = head.replace(/^\[[ xX]\]\s*/, "").trimEnd();
      lines.push(`${marker}${checkbox.hasAttribute("checked") ? "[x]" : "[ ]"} ${head}`.trimEnd());
    } else {
      lines.push(marker + head);
    }
    for (const block of blocks.slice(1)) {
      // Continuation content must line up with the item text, which starts after
      // the marker plus its space ("1. " -> 3 columns, "- " -> 2).
      lines.push(mdIndentBlock(block, " ".repeat(marker.length)));
    }
  }
  return lines.join("\n");
}

function mdTable(table: HTMLElement, baseUrl: string): string {
  const rowNodes = Array.from(
    table.querySelectorAll<HTMLElement>(":scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr")
  );
  const rows = rowNodes.length ? rowNodes : Array.from(table.querySelectorAll<HTMLElement>("tr"));
  const grid = rows
    .map((row) =>
      Array.from(row.children)
        .filter((cell) => /^(td|th)$/i.test(cell.tagName))
        .map((cell) => mdInlineNodes(Array.from(cell.childNodes), baseUrl).replace(/\|/g, "\\|").replace(/\n+/g, " ").trim())
    )
    .filter((cells) => cells.length > 0);
  if (!grid.length) return "";
  const columns = Math.max(...grid.map((cells) => cells.length));
  if (columns < 2) {
    return grid.flat().filter(Boolean).map((cell) => `- ${cell}`).join("\n");
  }
  const pad = (cells: string[]) => [...cells, ...Array<string>(columns - cells.length).fill("")];
  const lines = [`| ${pad(grid[0]).join(" | ")} |`, `| ${Array<string>(columns).fill("---").join(" | ")} |`];
  for (const cells of grid.slice(1)) lines.push(`| ${pad(cells).join(" | ")} |`);
  return lines.join("\n");
}

function mdFigure(figure: HTMLElement, baseUrl: string): string {
  const parts: string[] = [];
  const media = figure.querySelector<HTMLElement>(":scope > img, :scope > picture img, :scope > a > img, :scope > video");
  if (media) {
    const rendered = mdInlineNodes([media], baseUrl).trim();
    if (rendered) parts.push(rendered);
  }
  const caption = figure.querySelector<HTMLElement>(":scope > figcaption");
  if (caption) {
    const text = mdInlineNodes(Array.from(caption.childNodes), baseUrl).trim();
    if (text) parts.push(`*${text}*`);
  }
  if (parts.length) return parts.join("\n\n");
  return mdBlocksFromChildren(figure, baseUrl).join("\n\n");
}

function mdDefinitionList(list: HTMLElement, baseUrl: string): string {
  const blocks: string[] = [];
  let term = "";
  const flushTerm = () => {
    if (!term) return;
    blocks.push(`**${term}**`);
    term = "";
  };
  for (const child of Array.from(list.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === "dt") {
      flushTerm();
      term = mdInlineNodes(Array.from(child.childNodes), baseUrl).replace(/\s+/g, " ").trim();
      continue;
    }
    if (tag !== "dd") continue;
    const hasBlockChild = Array.from(child.children).some((el) => MD_BLOCK_TAGS.has(el.tagName.toLowerCase()));
    const inline = hasBlockChild ? "" : mdInlineNodes(Array.from(child.childNodes), baseUrl).replace(/\s+/g, " ").trim();
    if (term && inline) {
      blocks.push(`**${term}**: ${inline}`);
      term = "";
      continue;
    }
    flushTerm();
    const body = mdBlocksFromChildren(child, baseUrl);
    if (body.length) blocks.push(...body);
  }
  flushTerm();
  return blocks.join("\n\n");
}

function mdDetails(details: HTMLElement, baseUrl: string): string {
  const summary = details.querySelector<HTMLElement>(":scope > summary");
  const head = summary ? mdInlineNodes(Array.from(summary.childNodes), baseUrl).trim() : "";
  // Walk a summary-free clone so the disclosure label never shows up twice.
  const clone = details.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(":scope > summary").forEach((node) => node.remove());
  const body = mdBlocksFromChildren(clone, baseUrl);
  return [head ? `**${head}**` : "", ...body].filter(Boolean).join("\n\n");
}

function mdBlockFromNode(node: Node, baseUrl: string): string {
  if (node.nodeType === 3) {
    return mdCollapseSpace(node.nodeValue ?? "").trim();
  }
  if (node.nodeType !== 1) return "";
  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  if (MD_SKIP_TAGS.has(tag)) return "";
  if (mdIsNoiseElement(element)) return "";
  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const text = mdInlineNodes(Array.from(element.childNodes), baseUrl).trim();
      return text ? `${"#".repeat(Number(tag.charAt(1)))} ${text}` : "";
    }
    case "p": {
      return mdInlineNodes(Array.from(element.childNodes), baseUrl).trim();
    }
    case "hr":
      return "---";
    case "br":
      return "";
    case "pre":
      return mdCodeBlock(element);
    case "blockquote": {
      const inner = mdBlocksFromChildren(element, baseUrl).join("\n\n");
      if (!inner) return "";
      return inner
        .split("\n")
        .map((line) => (line.length ? `> ${line}` : ">"))
        .join("\n");
    }
    case "ul":
    case "ol":
      return mdList(element, baseUrl);
    case "table":
      return mdTable(element, baseUrl);
    case "figure":
      return mdFigure(element, baseUrl);
    case "figcaption": {
      const text = mdInlineNodes(Array.from(element.childNodes), baseUrl).trim();
      return text ? `*${text}*` : "";
    }
    case "dl":
      return mdDefinitionList(element, baseUrl);
    case "details":
      return mdDetails(element, baseUrl);
    case "summary": {
      const text = mdInlineNodes(Array.from(element.childNodes), baseUrl).trim();
      return text ? `**${text}**` : "";
    }
    case "video":
    case "audio": {
      const source = element.querySelector<HTMLElement>("source[src]");
      const src = mdAbsoluteLink(element.getAttribute("src") ?? source?.getAttribute("src") ?? null, baseUrl);
      const label = element.getAttribute("title") ?? tag;
      return src ? `[${label}](${src})` : "";
    }
    default:
      break;
  }
  const children = mdBlocksFromChildren(element, baseUrl);
  if (children.length) return children.join("\n\n");
  return mdInlineNodes(Array.from(element.childNodes), baseUrl).trim();
}

function mdBlocksFromChildren(parent: Node, baseUrl: string): string[] {
  const blocks: string[] = [];
  let inlineRun: Node[] = [];
  const flushInlineRun = () => {
    if (!inlineRun.length) return;
    const text = mdInlineNodes(inlineRun, baseUrl).trim();
    inlineRun = [];
    if (text) blocks.push(text);
  };
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 3) {
      if ((child.nodeValue ?? "").trim()) inlineRun.push(child);
      continue;
    }
    if (child.nodeType !== 1) continue;
    const tag = (child as HTMLElement).tagName.toLowerCase();
    if (MD_SKIP_TAGS.has(tag)) continue;
    if (mdIsNoiseElement(child as HTMLElement)) continue;
    if (MD_BLOCK_TAGS.has(tag) && !(tag === "td" || tag === "th" || tag === "tr" || tag === "tbody" || tag === "thead" || tag === "tfoot")) {
      flushInlineRun();
      const produced = mdBlockFromNode(child, baseUrl).trim();
      if (produced) blocks.push(produced);
      continue;
    }
    inlineRun.push(child);
  }
  flushInlineRun();
  return blocks;
}

function htmlDocumentToMarkdown(root: Node, baseUrl: string): string {
  const blocks: string[] = [];
  let length = 0;
  for (const block of mdBlocksFromChildren(root, baseUrl)) {
    const clean = mdNormalizeBlockWhitespace(block);
    if (!clean) continue;
    const budget = MD_MAX_READER_CHARS - length;
    if (budget <= 0) break;
    if (clean.length > budget) {
      // Trim inside the oversized block instead of skipping it: dropping whole
      // blocks made long pages lose everything after the first section.
      const slice = clean.slice(0, budget);
      const boundary = slice.lastIndexOf("\n");
      blocks.push((boundary > 0 ? slice.slice(0, boundary) : slice).replace(/\s+$/, ""));
      length = MD_MAX_READER_CHARS;
      break;
    }
    blocks.push(clean);
    length += clean.length + 2;
  }
  return blocks.join("\n\n");
}

/**
 * Trims decorative trailing whitespace line by line while keeping the two
 * trailing spaces that Markdown uses as a hard line break (`<br>` in source).
 */
function mdNormalizeBlockWhitespace(block: string): string {
  return block
    .split("\n")
    .map((line) => {
      const bare = line.replace(/[ \t]+$/, "");
      return line.length - bare.length >= 2 ? `${bare}  ` : bare;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function relatedSearches(query: string): string[] {
  const clean = query.trim();
  if (!clean) return [];
  return [
    `${clean}是什么意思`,
    `${clean}的英文`,
    `${clean}什么意思中文`,
    `${clean}怎么读`,
    `${clean}现场`,
    `${clean}官网`,
    "hey",
    "bye"
  ];
}

function fallbackSearchResults(query: string): SearchResult[] {
  const url = DEFAULT_SEARCH.replace("{{query}}", encodeURIComponent(query));
  return [
    {
      title: `Bing 搜索：${query}`,
      url,
      snippet: `查看 Bing 对“${query}”的网页、图片、视频和相关结果。`
    }
  ];
}

function looksLikeDownloadUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return BINARY_URL_PATTERN.test(`${parsed.pathname}${parsed.search}`);
  } catch {
    return BINARY_URL_PATTERN.test(url);
  }
}

function buildQrSvgDataUrl(value: string): string {
  const qrcode = (qrcodeFactory as unknown as { default?: typeof qrcodeFactory } & typeof qrcodeFactory).default ?? qrcodeFactory;
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function createDefaultUserScriptRule(): UserScriptRule {
  return {
    id: `script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "新脚本",
    match: "*://*/*",
    enabled: true,
    css: "",
    js: "",
    runAt: "reader",
    time: Date.now()
  };
}

function createBuiltInUserScriptRules(): UserScriptRule[] {
  const now = Date.now();
  return [
    {
      id: "builtin-copy-unlock",
      name: "油猴预设：解除复制限制",
      match: "*://*/*",
      enabled: true,
      css: [
        ".mwv-note-surface, .mwv-note-surface * {",
        "  -webkit-user-select: text ;",
        "  user-select: text ;",
        "}",
        ".mwv-note-surface a, .mwv-note-surface button {",
        "  -webkit-touch-callout: default;",
        "}"
      ].join("\n"),
      js: [
        "const lockedAttrs = ['oncopy','oncut','onpaste','onselectstart','oncontextmenu','ondragstart'];",
        "container.querySelectorAll(lockedAttrs.map((name) => `[${name}]`).join(',')).forEach((el) => {",
        "  for (const name of lockedAttrs) el.removeAttribute(name);",
        "});",
        "for (const type of ['copy','cut','paste','selectstart','contextmenu']) {",
        "  container.addEventListener(type, (event) => event.stopPropagation(), true);",
        "}"
      ].join("\n"),
      runAt: "reader",
      time: now
    },
    {
      id: "builtin-reader-clean",
      name: "油猴预设：阅读排版增强",
      match: "*://*/*",
      enabled: true,
      css: [
        ".mwv-md-content { line-height: 1.72; }",
        ".mwv-md-content p { margin: 0.72em 0; }",
        ".mwv-md-content h1, .mwv-md-content h2, .mwv-md-content h3 { line-height: 1.25; margin-top: 1.1em; }",
        ".mwv-md-content pre, .mwv-md-content code { white-space: pre-wrap; overflow-wrap: anywhere; }",
        ".mwv-md-content blockquote { border-left: 3px solid var(--interactive-accent); padding-left: 10px; color: var(--text-muted); }"
      ].join("\n"),
      js: "",
      runAt: "reader",
      time: now + 1
    },
    {
      id: "builtin-image-viewer",
      name: "油猴预设：图片查看增强",
      match: "*://*/*",
      enabled: true,
      css: [
        ".mwv-md-content img {",
        "  max-width: 100% ;",
        "  height: auto ;",
        "  border-radius: 6px;",
        "  cursor: zoom-in;",
        "}",
        ".mwv-md-content figure { margin-inline: 0; }"
      ].join("\n"),
      js: [
        "container.querySelectorAll('img').forEach((img) => {",
        "  img.loading = 'lazy';",
        "  img.decoding = 'async';",
        "  // Images stay inside NoteWeb; external navigation is handled by the host.",
        "});"
      ].join("\n"),
      runAt: "reader",
      time: now + 2
    },
    {
      id: "builtin-table-scroll",
      name: "油猴预设：表格横滑",
      match: "*://*/*",
      enabled: true,
      css: [
        ".mwv-table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }",
        ".mwv-table-scroll table { min-width: max-content; }",
        ".mwv-md-content table { border-collapse: collapse; }",
        ".mwv-md-content th, .mwv-md-content td { padding: 6px 8px; border: 1px solid var(--background-modifier-border); }"
      ].join("\n"),
      js: [
        "container.querySelectorAll('table').forEach((table) => {",
        "  if (table.parentElement?.classList.contains('mwv-table-scroll')) return;",
        "  const wrap = container.ownerDocument.createElement('div');",
        "  wrap.className = 'mwv-table-scroll';",
        "  table.parentElement?.insertBefore(wrap, table);",
        "  wrap.appendChild(table);",
        "});"
      ].join("\n"),
      runAt: "reader",
      time: now + 3
    }
  ];
}

function wildcardMatch(pattern: string, value: string): boolean {
  const clean = pattern.trim();
  if (!clean || clean === "*") return true;
  const escaped = clean.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

function sanitizeFileName(value: string, fallback = "download"): string {
  const safe = Array.from(value, (char) =>
    INVALID_FILE_NAME_CHARS.has(char) || char.charCodeAt(0) < 32 ? " " : char
  ).join("");
  const clean = safe
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110);
  return clean || fallback;
}

function extensionFromMime(mime: string): string {
  const clean = mime.split(";")[0].trim().toLowerCase();
  if (clean.includes("html")) return "html";
  if (clean.includes("javascript")) return "js";
  if (clean.includes("css")) return "css";
  if (clean.includes("json")) return "json";
  if (clean.includes("pdf")) return "pdf";
  if (clean.includes("png")) return "png";
  if (clean.includes("jpeg") || clean.includes("jpg")) return "jpg";
  if (clean.includes("gif")) return "gif";
  if (clean.includes("webp")) return "webp";
  if (clean.includes("svg")) return "svg";
  if (clean.includes("zip")) return "zip";
  if (clean.includes("mpeg")) return "mp3";
  if (clean.includes("mp4")) return "mp4";
  return "bin";
}

function fileNameFromUrl(url: string, mime = ""): string {
  try {
    const parsed = new URL(url);
    const last = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() ?? "");
    const base = sanitizeFileName(last || hostName(url), "download");
    if (/\.[a-z0-9]{1,8}$/i.test(base)) return base;
    return `${base}.${extensionFromMime(mime)}`;
  } catch {
    return `download.${extensionFromMime(mime)}`;
  }
}

function appendFileExtension(fileName: string, ext: string): string {
  const cleanExt = ext.replace(/^\./, "");
  return fileName.toLowerCase().endsWith(`.${cleanExt.toLowerCase()}`) ? fileName : `${fileName}.${cleanExt}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary).replace(/(.{76})/g, "$1\r\n");
}

function textToArrayBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

function concatArrayBuffers(parts: ArrayBuffer[]): ArrayBuffer {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(new Uint8Array(part), offset);
    offset += part.byteLength;
  }
  return merged.buffer;
}

function contentDispositionFileName(value: string | undefined): string {
  if (!value) return "";
  const utf = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf?.[1]) {
    try {
      return sanitizeFileName(decodeURIComponent(utf[1]));
    } catch {
      return sanitizeFileName(utf[1]);
    }
  }
  const ascii = value.match(/filename="?([^";]+)"?/i);
  return ascii?.[1] ? sanitizeFileName(ascii[1]) : "";
}

function headerValue(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return "";
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key] ?? "";
  }
  return "";
}

function makeContentId(index: number, url: string): string {
  return `mwv-${index}-${Math.abs(url.split("").reduce((sum, char) => ((sum << 5) - sum + char.charCodeAt(0)) | 0, 0))}@mobile-webviewer`;
}

function simpleHash(value: string): string {
  return Math.abs(value.split("").reduce((sum, char) => ((sum << 5) - sum + char.charCodeAt(0)) | 0, 0)).toString(36);
}

function webNoteId(url: string): string {
  return `webnote-${simpleHash(url)}-${simpleHash(hostName(url))}`;
}

function isBuiltInShortcut(entry: WebEntry): boolean {
  const title = (entry.title || "").trim().toLowerCase();
  const url = entry.url.trim().toLowerCase().replace(/\/+$/, "");
  return (
    (title === "bing" && /^https:\/\/(www\.)?bing\.com$/i.test(url)) ||
    (title === "wikipedia" && /^https:\/\/(www\.)?wikipedia\.org$/i.test(url))
  );
}

function escapeMarkdownText(value: string): string {
  return value.replace(/\r/g, "").replace(/\u00a0/g, " ").trim();
}

function htmlToMarkdownFromElement(root: HTMLElement): string {
  const lines: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = escapeMarkdownText(node.textContent ?? "");
      if (text) lines.push(text);
      return;
    }
    if (!isHtmlElement(node)) return;
    if (node.closest(".mwv-note-actions, .mwv-note-source, .mwv-doodle-layer, .mwv-webnote-meta")) return;
    const tag = node.tagName.toLowerCase();
    const text = escapeMarkdownText(node.innerText ?? node.textContent ?? "");
    if (!text && tag !== "img") return;
    if (tag === "h1") lines.push(`# ${text}`);
    else if (tag === "h2") lines.push(`## ${text}`);
    else if (tag === "h3") lines.push(`### ${text}`);
    else if (tag === "li") lines.push(`- ${text}`);
    else if (tag === "p" || tag === "div" || tag === "section" || tag === "article") {
      if (Array.from(node.children).some((child) => ["H1", "H2", "H3", "P", "UL", "OL", "LI"].includes(child.tagName))) {
        Array.from(node.childNodes).forEach(visit);
      } else if (text) {
        lines.push(text);
      }
    } else if (tag === "img") {
      const src = node.getAttribute("src") || "";
      if (src) lines.push(`![](${src})`);
    } else {
      Array.from(node.childNodes).forEach(visit);
    }
  };
  Array.from(root.childNodes).forEach(visit);
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index, all) => index === 0 || line !== all[index - 1])
    .join("\n\n");
}

function webNoteMarkdown(entry: WebNoteEntry): string {
  const title = entry.title || entry.sourceTitle || hostName(entry.url);
  const body = entry.noteText || htmlToText(entry.noteHtml);
  const pageEdit = entry.pageText
    ? `\n\n## Page edits\n\n${escapeMarkdownText(entry.pageText)}`
    : "";
  const doodle = entry.doodleSvg ? `\n\n## Doodle\n\n\`\`\`svg\n${entry.doodleSvg}\n\`\`\`` : "";
  return [
    "---",
    `source: ${entry.url}`,
    `saved: ${new Date(entry.updatedAt).toISOString()}`,
    "type: mobile-webviewer-note",
    "---",
    "",
    `# ${title}`,
    "",
    entry.url,
    "",
    body,
    pageEdit,
    doodle
  ].join("\n").trim() + "\n";
}

function normalizeTranslateLanguageCode(code: string): string {
  const clean = code.trim().replace(/_/g, "-").toLowerCase();
  if (!clean) return "en";
  if (clean.startsWith("zh")) {
    return clean.includes("hant") || clean.includes("tw") || clean.includes("hk") ? "zh-Hant" : "zh-Hans";
  }
  if (clean.startsWith("pt")) return "pt";

  const exact = TRANSLATE_LANGUAGES.find((item) => item.code.toLowerCase() === clean);
  if (exact) return exact.code;

  const base = clean.split("-")[0];
  const baseMatch = TRANSLATE_LANGUAGES.find((item) => item.code.toLowerCase() === base);
  return baseMatch?.code ?? "en";
}

function getObsidianLanguageCode(): string {
  const doc = appDocument();
  return normalizeTranslateLanguageCode(doc.documentElement.lang || navigator.language || "en");
}

function isUiLanguage(code: string): boolean {
  return code === DEFAULT_UI_LANGUAGE || TRANSLATE_LANGUAGES.some((item) => item.code === code);
}

function resolveUiLanguageCode(target: string): string {
  return target === DEFAULT_UI_LANGUAGE ? getObsidianLanguageCode() : normalizeTranslateLanguageCode(target);
}

function translateUiText(language: string, key: UiTextKey, values: Record<string, string | number> = {}): string {
  const resolved = resolveUiLanguageCode(language);
  const dictionary = UI_DICTIONARIES[resolved] ?? UI_TEXT_EN;
  const template = dictionary[key] ?? UI_TEXT_EN[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? `{${name}}`));
}

function isRtlUiLanguage(language: string): boolean {
  return ["ar", "fa", "ur", "ug"].includes(resolveUiLanguageCode(language));
}

function acceptLanguageHeader(language: string): string {
  const resolved = resolveUiLanguageCode(language);
  const browser = navigator.language || "en";
  switch (resolved) {
    case "zh-Hans":
      return "zh-CN,zh;q=0.9,en;q=0.7";
    case "zh-Hant":
      return "zh-TW,zh-Hant;q=0.9,zh;q=0.8,en;q=0.7";
    case "ug":
      return "ug-CN,ug;q=0.9,zh-CN;q=0.7,en;q=0.6";
    case "en":
      return "en-US,en;q=0.9";
    default:
      return `${resolved},${browser};q=0.8,en;q=0.6`;
  }
}

function resolveTranslateTargetCode(target: string): string {
  return target === "ob" ? getObsidianLanguageCode() : normalizeTranslateLanguageCode(target);
}

function translateLanguage(code: string): LanguageOption {
  const resolved = resolveTranslateTargetCode(code);
  return TRANSLATE_LANGUAGES.find((item) => item.code === resolved) ?? TRANSLATE_LANGUAGES[0];
}

function isTranslateLanguage(code: string): boolean {
  return code === "ob" || TRANSLATE_LANGUAGES.some((item) => item.code === code);
}

function buildTranslateUrl(url: string, target: string): string {
  const lang = resolveTranslateTargetCode(target);
  return `https://www.translatetheweb.com/?from=&to=${encodeURIComponent(lang)}&a=${encodeURIComponent(url)}`;
}

function translateModeLabel(code: string): string {
  if (code === "ob") return FOLLOW_OBSIDIAN_TRANSLATE_OPTION.native;
  return translateLanguage(code).native;
}

class MobileWebviewerView extends ItemView {
  plugin: MobileWebviewerPlugin;
  surfaceEl!: BrowserSurfaceElement;
  homeEl!: HTMLElement;
  addressEl!: HTMLInputElement;
  titleEl!: HTMLElement;
  subtitleEl!: HTMLElement;
  tabStripEl!: HTMLElement;
  findPanelEl?: HTMLElement;
  morePanelEl?: HTMLElement;
  drawerEl!: HTMLElement;
  listEl!: HTMLElement;
  bookmarksTabEl!: HTMLButtonElement;
  historyTabEl!: HTMLButtonElement;
  readingTabEl!: HTMLButtonElement;
  downloadsTabEl!: HTMLButtonElement;
  consoleTabEl!: HTMLButtonElement;
  currentUrl = "";
  currentTitle = "";
  activeBrowserTabId = "";
  backStack: string[] = [];
  forwardStack: string[] = [];
  lastQuery = "";
  surfaceNavMode: "programmatic" | "back" | "forward" | "reload" | "" = "";
  frontendMode: "note" | "web" | "split" = "note";
  currentWebNote?: WebNoteEntry;
  webNoteSaveTimer?: number;
  webNoteDoodleSaveTimer?: number;
  activeDoodlePath?: SVGPathElement;
  activeDoodlePointerId?: number;
  activeDoodleSvg?: SVGSVGElement;
  currentDrawer: "bookmarks" | "history" | "reading" | "downloads" | "console" = "bookmarks";

  constructor(leaf: WorkspaceLeaf, plugin: MobileWebviewerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  tr(key: UiTextKey, values: Record<string, string | number> = {}): string {
    return this.plugin.tr(key, values);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.plugin.tr("noteBrowser");
  }

  getIcon(): string {
    return "smartphone";
  }

  async onOpen(): Promise<void> {
    this.build();
    const tab = this.plugin.ensureBrowserTab(this.activeBrowserTabId || this.plugin.settings.activeBrowserTabId);
    this.activeBrowserTabId = tab.id;
    this.applyBrowserTab(tab);
    this.renderTabStrip();
    this.navigate(tab.url || this.plugin.settings.homeUrl, false);
    this.ensureNoteDrawWandButton();
  }

  async onClose(): Promise<void> {
    this.plugin.disposeBrowserSurface(this.surfaceEl);
    await this.saveCurrentWebNoteNow();
  }

  build(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("mwv-root");
    root.toggleClass("mwv-compact", this.plugin.settings.compactToolbar);
    this.plugin.applyBrowserRuntimeClasses(root);

    const header = root.createDiv({ cls: "mwv-header" });
    const form = header.createEl("form", { cls: "mwv-address-row" });
    const searchIcon = form.createSpan({ cls: "mwv-address-icon", attr: { "aria-hidden": "true" } });
    setIcon(searchIcon, "search");
    this.addressEl = form.createEl("input", {
      cls: "mwv-address",
      attr: {
        type: "text",
        inputmode: "url",
        autocomplete: "off",
        autocapitalize: "off",
        spellcheck: "false",
        placeholder: this.plugin.tr("searchOrEnterUrl")
      }
    });
    const goButton = form.createEl("button", {
      cls: "mwv-icon-button mwv-primary",
      attr: { type: "submit", "aria-label": this.plugin.tr("go") }
    });
    setIcon(goButton, "arrow-right");
    const moreButton = form.createEl("button", {
      cls: "mwv-icon-button",
      attr: { type: "button", "aria-label": this.plugin.tr("more"), title: this.plugin.tr("more") }
    });
    setIcon(moreButton, "more-horizontal");
    moreButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openMoreMenu(moreButton);
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.navigate(normalizeInput(this.addressEl.value, this.plugin.settings.searchUrl), true);
    });

    const meta = header.createDiv({ cls: "mwv-meta" });
    this.titleEl = meta.createDiv({ cls: "mwv-title" });
    this.subtitleEl = meta.createDiv({ cls: "mwv-subtitle", text: this.plugin.tr("ready") });
    this.tabStripEl = header.createDiv({ cls: "mwv-tab-strip" });

    const frameWrap = root.createDiv({ cls: "mwv-frame-wrap" });
    this.homeEl = frameWrap.createDiv({ cls: "mwv-home mwv-virtual-md" });
    this.buildHome();

    this.surfaceEl = this.plugin.createBrowserSurface(frameWrap, "", "mwv-frame", this.plugin.tr("noteBrowser"), {
      raw: true,
      onReady: () => this.handleSurfaceReady(),
      onNavigate: (url) => this.handleSurfaceNavigate(url),
      onTitle: (title) => this.handleSurfaceTitle(title),
      onFail: (message, url) => {
        this.subtitleEl.setText(message);
        void this.plugin.addConsole("warn", `Page load issue: ${message}`, url ?? this.currentUrl);
        // Raw Web mode must remain the original page. A transient main-frame
        // error should be reported, but must not asynchronously replace the
        // live WebView with the reader and create the delayed layout jump.
        if (this.frontendMode === "web" && this.plugin.isRawRealBrowserSurface(this.surfaceEl)) return;
        void this.showReaderFallbackForCurrentPage(url ?? this.currentUrl, message);
      },
      onConsole: (level, message, url) => this.plugin.addConsole(level, message, url ?? this.currentUrl),
      onNewWindow: (url) => this.openPopupTab(url),
      onLoading: (loading, url) => this.handleSurfaceLoading(loading, url),
      onFavicon: (iconUrl) => this.plugin.addConsole("info", `Favicon: ${iconUrl}`, this.currentUrl),
      onDownloadCandidate: (downloadUrl) => this.handleSurfaceDownload(downloadUrl),
      onContextLink: (linkUrl, linkTitle) => this.setContextLink(linkUrl, linkTitle),
      onWebNotePatch: (patch) => { void this.plugin.saveBrowserSurfaceWebNotePatch(patch); }
    });
    this.plugin.applyFrameViewPreferences(this.surfaceEl);
    this.surfaceEl.addEventListener("contextmenu", (event) => {
      const contextUrl = this.addressEl.title && /^https?:\/\//i.test(this.addressEl.title) ? this.addressEl.title : this.currentUrl;
      this.openLinkContextMenu(event as MouseEvent, contextUrl, this.currentTitle || hostName(contextUrl));
    });

    this.drawerEl = root.createDiv({ cls: "mwv-drawer" });
    const drawerHead = this.drawerEl.createDiv({ cls: "mwv-drawer-head" });
    const tabs = drawerHead.createDiv({ cls: "mwv-tabs" });
    this.bookmarksTabEl = tabs.createEl("button", { cls: "mwv-tab is-active", text: this.plugin.tr("bookmarks") });
    this.historyTabEl = tabs.createEl("button", { cls: "mwv-tab", text: this.plugin.tr("history") });
    this.readingTabEl = tabs.createEl("button", { cls: "mwv-tab", text: this.plugin.tr("reading") });
    this.downloadsTabEl = tabs.createEl("button", { cls: "mwv-tab", text: this.plugin.tr("downloads") });
    this.consoleTabEl = tabs.createEl("button", { cls: "mwv-tab", text: this.plugin.tr("console") });
    const closeDrawer = drawerHead.createEl("button", {
      cls: "mwv-icon-button",
      attr: { type: "button", "aria-label": this.plugin.tr("closePanel") }
    });
    setIcon(closeDrawer, "x");
    this.listEl = this.drawerEl.createDiv({ cls: "mwv-list" });

    closeDrawer.addEventListener("click", () => this.closeDrawer());
    this.bookmarksTabEl.addEventListener("click", () => {
      this.openDrawer("bookmarks");
    });
    this.historyTabEl.addEventListener("click", () => {
      this.openDrawer("history");
    });
    this.readingTabEl.addEventListener("click", () => {
      this.openDrawer("reading");
    });
    this.downloadsTabEl.addEventListener("click", () => {
      this.openDrawer("downloads");
    });
    this.consoleTabEl.addEventListener("click", () => {
      this.openDrawer("console");
    });

    const toolbar = root.createDiv({ cls: "mwv-toolbar" });
    this.makeToolButton(toolbar, "arrow-left", this.plugin.tr("back"), () => this.goBack());
    this.makeToolButton(toolbar, "arrow-right", this.plugin.tr("forward"), () => this.goForward());
    this.makeToolButton(toolbar, "rotate-cw", this.plugin.tr("reload"), () => this.reload());
    this.makeToolButton(toolbar, "home", this.plugin.tr("home"), () => this.navigate(this.plugin.settings.homeUrl, true));
    this.makeModeButton(toolbar, "file-text", this.plugin.tr("note"), "note");
    this.makeModeButton(toolbar, "globe-2", this.plugin.tr("web"), "web");
    this.makeToolButton(toolbar, "notebook-tabs", this.plugin.tr("noteBrowser"), () => void this.openCurrentInNoteBrowser());
    this.makeToolButton(toolbar, "file-down", this.plugin.tr("saveMd"), () => void this.exportCurrentWebNote());
    this.makeToolButton(toolbar, "star", this.plugin.tr("bookmark"), () => void this.toggleBookmark());
    this.makeToolButton(toolbar, "book-open", this.plugin.tr("bookmarks"), () => void this.openUtilityTab("bookmarks"));
    this.makeToolButton(toolbar, "history", this.plugin.tr("history"), () => void this.openUtilityTab("history"));
    this.makeToolButton(toolbar, "download", this.plugin.tr("downloads"), () => void this.openUtilityTab("downloads"));
    this.makeToolButton(toolbar, "plus-square", this.plugin.tr("saveLink"), () => void this.captureLink());
    this.makeToolButton(toolbar, "settings", this.plugin.tr("settings"), () => this.plugin.openSettings());

    this.renderDrawer("bookmarks");
    this.syncSurfaceIdentity();
    this.queueNoteDrawPageRefresh();
  }

  makeModeButton(parent: HTMLElement, icon: string, label: string, mode: "note" | "web" | "split"): HTMLButtonElement {
    const button = this.makeToolButton(parent, icon, label, () => this.setFrontendMode(mode));
    button.dataset.mwvMode = mode;
    button.addClass("mwv-mode-button");
    button.toggleClass("is-active", this.frontendMode === mode);
    return button;
  }

  makeToolButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: (button: HTMLButtonElement, event: MouseEvent) => void
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "mwv-tool-button",
      attr: {
        type: "button",
        "aria-label": label,
        title: label
      }
    });
    setIcon(button, icon);
    button.createSpan({ cls: "mwv-tool-label", text: label });
    button.addEventListener("click", (event) => onClick(button, event));
    return button;
  }

  isRealBrowserSurface(): boolean {
    return this.plugin.isElectronWebview(this.surfaceEl);
  }

  setSurfaceUrl(url: string): void {
    this.surfaceNavMode = "programmatic";
    this.syncSurfaceIdentity(url, this.currentTitle || hostName(url));
    this.plugin.setBrowserSurfaceUrl(this.surfaceEl, url);
  }

  syncSurfaceIdentity(url = this.currentUrl || this.plugin.settings.homeUrl, title = this.currentTitle || hostName(url)): void {
    const root = this.containerEl.children[1] as HTMLElement | undefined;
    const pageChanged = Boolean(root && root.dataset.url !== url);
    if (root) {
      root.dataset.url = url;
      root.dataset.mwvTitle = title;
      root.setAttribute("data-url", url);
      root.setAttribute("data-mwv-title", title);
    }
    const frameWrap = this.surfaceEl?.parentElement;
    if (frameWrap) {
      frameWrap.dataset.url = url;
      frameWrap.dataset.mwvTitle = title;
      frameWrap.setAttribute("data-url", url);
      frameWrap.setAttribute("data-mwv-title", title);
    }
    if (pageChanged) this.queueNoteDrawPageRefresh();
  }

  queueNoteDrawPageRefresh(forceEditMode = false): void {
    // The standalone browser view is intentionally independent from NoteDraw.
    // A delayed controller refresh used to mount a second canvas over a page
    // shortly after first paint, which made the raw WebView jump or collapse.
    // NoteDraw remains available to ordinary Markdown notes and is handled by
    // the Markdown embed path only.
    void forceEditMode;
  }

  handleSurfaceReady(): void {
    this.syncSurfaceIdentity();
    void this.plugin.applyAccessibleFrameFilters(this.surfaceEl, this.currentUrl);
    this.subtitleEl.setText(hostName(this.currentUrl));
    const title = this.plugin.getBrowserSurfaceTitle(this.surfaceEl);
    if (title) {
      this.handleSurfaceTitle(title);
    }
    this.ensureNoteDrawWandButton();
  }

  /** Mounts the shared NoteDraw wand proxy so real web pages get the same magic wand as NoteWeb. */
  ensureNoteDrawWandButton(): void {
    window.setTimeout(() => {
      this.plugin.ensureNoteWebWandProxy(this.surfaceEl, true);
    }, 120);
  }

  handleSurfaceTitle(title: string): void {
    if (!title.trim()) return;
    this.currentTitle = title.trim();
    this.titleEl.setText(this.currentTitle);
    this.syncSurfaceIdentity();
    void this.syncActiveBrowserTab();
    this.renderTabStrip();
  }

  handleSurfaceLoading(loading: boolean, url?: string): void {
    this.surfaceEl.toggleClass("is-loading", loading);
    this.subtitleEl.setText(loading ? `Loading ${hostName(url || this.currentUrl)}` : hostName(url || this.currentUrl));
  }

  async handleSurfaceDownload(url: string): Promise<void> {
    await this.plugin.addConsole("info", `Detected download link: ${url}`, this.currentUrl);
    const entry = await this.plugin.downloadUrlFile(url);
    new Notice(this.plugin.tr("downloadComplete", { path: entry.path || entry.message }));
    await this.openUtilityTab("downloads");
  }

  handleSurfaceNavigate(url: string): void {
    if (!url || url === "about:blank" || url.startsWith("devtools://")) return;
    const nextUrl = normalizeInput(url, this.plugin.settings.searchUrl);
    if (!nextUrl) return;
    const previous = this.currentUrl;
    const mode = this.surfaceNavMode;
    this.surfaceNavMode = "";

    if (previous && previous !== nextUrl) {
      this.flushCurrentWebNoteBeforeRender();
      if (mode === "back") {
        if (!this.forwardStack.includes(previous)) this.forwardStack.push(previous);
      } else if (mode === "forward") {
        if (!this.backStack.includes(previous)) this.backStack.push(previous);
      } else if (mode !== "programmatic" && mode !== "reload") {
        if (this.backStack[this.backStack.length - 1] !== previous) this.backStack.push(previous);
        this.forwardStack = [];
      }
    }

    this.currentUrl = nextUrl;
    this.currentTitle = this.plugin.getBrowserSurfaceTitle(this.surfaceEl) || hostName(nextUrl);
    this.addressEl.value = nextUrl;
    this.titleEl.setText(this.currentTitle);
    this.subtitleEl.setText(hostName(nextUrl));
    this.syncSurfaceIdentity();
    void this.syncActiveBrowserTab();
    this.renderTabStrip();
    if (mode !== "programmatic" || previous !== nextUrl) {
      void this.plugin.addHistory({
        title: this.currentTitle,
        url: nextUrl,
        time: Date.now()
      });
    }
    this.plugin.emitApiEvent({ type: "navigate", url: nextUrl, title: this.currentTitle, tabId: this.activeBrowserTabId });
  }

  applyBrowserTab(tab: BrowserTab): void {
    this.currentUrl = tab.url || this.plugin.settings.homeUrl;
    this.currentTitle = tab.title || hostName(this.currentUrl);
    this.backStack = Array.isArray(tab.back) ? [...tab.back] : [];
    this.forwardStack = Array.isArray(tab.forward) ? [...tab.forward] : [];
    this.syncSurfaceIdentity();
  }

  renderTabStrip(): void {
    if (!this.tabStripEl) return;
    this.tabStripEl.empty();
    const tabs = this.plugin.settings.browserTabs.length
      ? this.plugin.settings.browserTabs
      : [this.plugin.ensureBrowserTab()];

    for (const tab of tabs.slice(0, MAX_BROWSER_TABS)) {
      const item = this.tabStripEl.createEl("button", {
        cls: tab.id === this.activeBrowserTabId ? "mwv-browser-tab is-active" : "mwv-browser-tab",
        attr: { type: "button", title: tab.url }
      });
      item.createSpan({ cls: "mwv-browser-tab-title", text: tab.title || hostName(tab.url) || "New tab" });
      const close = item.createSpan({ cls: "mwv-browser-tab-close", attr: { "aria-hidden": "true" } });
      setIcon(close, "x");
      item.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        event.preventDefault();
        event.stopPropagation();
        if (target?.closest(".mwv-browser-tab-close")) {
          runAsync(() => this.closeBrowserTab(tab.id));
        } else {
          runAsync(() => this.switchBrowserTab(tab.id));
        }
      });
    }

    const add = this.tabStripEl.createEl("button", {
      cls: "mwv-browser-tab-add",
      attr: { type: "button", title: this.plugin.tr("newObsidianTab"), "aria-label": this.plugin.tr("newObsidianTab") }
    });
    setIcon(add, "plus");
    add.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.newBrowserTab();
    });
  }

  async syncActiveBrowserTab(): Promise<void> {
    const id = this.activeBrowserTabId || this.plugin.settings.activeBrowserTabId;
    if (!id || !this.currentUrl) return;
    await this.plugin.updateBrowserTab(id, {
      title: this.currentTitle || hostName(this.currentUrl),
      url: this.currentUrl,
      back: [...this.backStack],
      forward: [...this.forwardStack],
      time: Date.now()
    });
  }

  async switchBrowserTab(id: string): Promise<void> {
    if (id === this.activeBrowserTabId) return;
    this.flushCurrentWebNoteBeforeRender();
    await this.syncActiveBrowserTab();
    const tab = this.plugin.settings.browserTabs.find((item) => item.id === id);
    if (!tab) return;
    this.activeBrowserTabId = id;
    this.plugin.settings.activeBrowserTabId = id;
    await this.plugin.saveSettings();
    this.applyBrowserTab(tab);
    this.renderTabStrip();
    this.navigateWithoutStack(this.currentUrl || this.plugin.settings.homeUrl);
    this.plugin.emitApiEvent({ type: "tab-change", tabId: id, url: tab.url, title: tab.title, detail: { operation: "switch" } });
  }

  async newBrowserTab(url = this.plugin.settings.homeUrl): Promise<void> {
    this.flushCurrentWebNoteBeforeRender();
    await this.syncActiveBrowserTab();
    const tab = this.plugin.createBrowserTab(url);
    this.plugin.settings.browserTabs.unshift(tab);
    this.plugin.settings.browserTabs = this.plugin.settings.browserTabs.slice(0, MAX_BROWSER_TABS);
    this.plugin.settings.activeBrowserTabId = tab.id;
    await this.plugin.saveSettings();
    await this.plugin.activateBrowserView(url, true, tab.id);
    this.plugin.emitApiEvent({ type: "tab-change", tabId: tab.id, url: tab.url, title: tab.title, detail: { operation: "new" } });
  }

  async closeBrowserTab(id: string): Promise<void> {
    this.flushCurrentWebNoteBeforeRender();
    await this.syncActiveBrowserTab();
    const tabs = this.plugin.settings.browserTabs;
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    if (tabs.length === 1) {
      const replacement = this.plugin.createBrowserTab(this.plugin.settings.homeUrl);
      this.plugin.settings.browserTabs = [replacement];
      this.plugin.settings.activeBrowserTabId = replacement.id;
      await this.plugin.saveSettings();
      this.applyBrowserTab(replacement);
      this.renderTabStrip();
      this.navigate(replacement.url, false);
      return;
    }

    tabs.splice(index, 1);
    this.plugin.emitApiEvent({ type: "tab-close", tabId: id });
    if (this.activeBrowserTabId === id) {
      const next = tabs[Math.min(index, tabs.length - 1)];
      this.activeBrowserTabId = next.id;
      this.plugin.settings.activeBrowserTabId = next.id;
      await this.plugin.saveSettings();
      this.applyBrowserTab(next);
      this.renderTabStrip();
      this.navigateWithoutStack(this.currentUrl || this.plugin.settings.homeUrl);
      return;
    }
    await this.plugin.saveSettings();
    this.renderTabStrip();
  }

  renderDrawer(kind: "bookmarks" | "history" | "reading" | "downloads" | "console"): void {
    if (!this.listEl) return;
    this.currentDrawer = kind;
    this.listEl.empty();
    const tabs = [
      [this.bookmarksTabEl, "bookmarks"],
      [this.historyTabEl, "history"],
      [this.readingTabEl, "reading"],
      [this.downloadsTabEl, "downloads"],
      [this.consoleTabEl, "console"]
    ] as const;
    for (const [tab, tabKind] of tabs) {
      tab.toggleClass("is-active", tabKind === kind);
    }

    if (kind === "console") {
      this.renderConsoleDrawer();
      return;
    }
    if (kind === "downloads") {
      this.renderDownloadsDrawer();
      return;
    }

    const entries =
      kind === "bookmarks"
        ? this.plugin.settings.bookmarks.filter((entry) => !isBuiltInShortcut(entry))
        : kind === "reading"
          ? this.plugin.settings.readingList
          : this.plugin.settings.history;
    if (!entries.length) {
      const label =
        kind === "bookmarks"
          ? this.plugin.tr("noBookmarksYet")
          : kind === "reading"
            ? this.plugin.tr("noReadingListYet")
            : this.plugin.tr("noHistoryYet");
      this.listEl.createDiv({ cls: "mwv-empty", text: label });
      return;
    }

    for (const entry of entries.slice(0, 12)) {
      const item = this.listEl.createEl("button", { cls: "mwv-list-item", attr: { type: "button" } });
      item.createDiv({ cls: "mwv-list-title", text: entry.title || hostName(entry.url) });
      item.createDiv({ cls: "mwv-list-url", text: entry.url });
      item.addEventListener("click", () => void this.newBrowserTab(entry.url));
    }
  }

  renderDownloadsDrawer(): void {
    if (!this.listEl) return;
    this.renderDownloadsList(this.listEl, this.plugin.settings.downloads);
  }

  renderConsoleDrawer(): void {
    if (!this.listEl) return;
    this.renderConsoleList(this.listEl, this.plugin.settings.consoleEntries);
  }

  buildHome(query = "", results: SearchResult[] = []): void {
    if (!this.homeEl) return;
    this.homeEl.empty();

    const article = this.homeEl.createEl("article", { cls: "mwv-note-surface mwv-search-note" });
    article.dataset.url = this.currentUrl || this.plugin.settings.homeUrl;
    article.createEl("h1", { text: query ? `${this.plugin.tr("search")}: ${query}` : this.plugin.tr("search") });

    const form = article.createEl("form", { cls: "mwv-home-search" });
    const icon = form.createSpan({ cls: "mwv-home-search-icon", attr: { "aria-hidden": "true" } });
    setIcon(icon, "search");
    const input = form.createEl("input", {
      cls: "mwv-home-input",
      value: query,
      attr: {
        type: "search",
        placeholder: this.plugin.tr("searchBing"),
        autocomplete: "off"
      }
    });
    const button = form.createEl("button", { cls: "mwv-home-go", attr: { type: "submit", "aria-label": this.plugin.tr("search") } });
    setIcon(button, "arrow-right");

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.searchBing(input.value);
    });

    if (results.length) {
      const list = article.createDiv({ cls: "mwv-results" });
      for (const result of results) {
        const item = list.createDiv({ cls: "mwv-result" });
        const titleLink = item.createEl("a", {
          cls: "mwv-result-title",
          text: result.title,
          href: result.url,
          attr: { "data-mwv-open-url": result.url, title: result.url }
        });
        titleLink.addEventListener("click", (event) => {
          event.preventDefault();
          this.navigate(result.url, true);
        });
        item.createDiv({ cls: "mwv-result-url", text: result.url });
        if (result.snippet) item.createDiv({ cls: "mwv-result-snippet", text: result.snippet });
      }
      if (query.trim() && results.length < 80) {
        const more = list.createEl("button", {
          cls: "mwv-more-results",
          text: this.plugin.tr("moreResults"),
          attr: { type: "button" }
        });
        more.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          runAsync(async () => {
          more.disabled = true;
          more.setText(this.tr("loading"));
          const nextMax = Math.min(80, Math.max(results.length + BING_DEFAULT_MAX_RESULTS, BING_DEFAULT_MAX_RESULTS * 2));
          const nextPages = Math.ceil(nextMax / BING_RESULTS_PER_PAGE);
          try {
            const expanded = await this.plugin.searchBing(query, nextPages, nextMax);
            this.subtitleEl.setText(this.plugin.tr("resultsCount", { count: expanded.length }));
            this.buildHome(query, expanded);
          } catch (error) {
            console.error("[mobile-webviewer] Bing more results failed", error);
            more.disabled = false;
            more.setText(this.tr("loadFailedRetry"));
          }
          });
        });
      }
    }
    this.queueNoteDrawPageRefresh();
  }

  openDrawer(kind: "bookmarks" | "history" | "reading" | "downloads" | "console"): void {
    this.closeMorePanel();
    this.drawerEl.addClass("is-open");
    this.renderDrawer(kind);
  }

  closeDrawer(): void {
    this.drawerEl.removeClass("is-open");
  }

  closeMorePanel(): void {
    this.morePanelEl?.remove();
    this.morePanelEl = undefined;
  }

  toggleMoreConsolePanel(panel: HTMLElement, url: string, message?: string): void {
    const existing = panel.querySelector<HTMLElement>(".mwv-console-panel");
    if (existing && !message) {
      existing.remove();
      return;
    }
    this.removeMoreUtilityPanels(panel);
    const consolePanel = panel.createDiv({ cls: "mwv-console-panel mwv-more-wide-panel" });
    consolePanel.createDiv({ cls: "mwv-console-title", text: message ?? `反馈日志 · ${hostName(url)}` });
    const entries = this.plugin.settings.consoleEntries.slice(0, 30);
    if (!entries.length) {
      consolePanel.createDiv({ cls: "mwv-console-empty", text: this.plugin.tr("emptyConsoleDesc") });
      return;
    }
    for (const entry of entries) {
      const row = consolePanel.createDiv({ cls: `mwv-console-row is-${entry.level}` });
      row.createDiv({ cls: "mwv-console-level", text: entry.level });
      const body = row.createDiv({ cls: "mwv-console-message" });
      body.createDiv({ text: entry.message });
      if (entry.url) body.createDiv({ cls: "mwv-console-url", text: entry.url });
    }
  }

  removeMoreUtilityPanels(panel: HTMLElement): void {
    [
      ".mwv-console-panel",
      ".mwv-reading-panel",
      ".mwv-userscript-panel",
      ".mwv-history-panel",
      ".mwv-downloads-panel",
      ".mwv-site-panel",
      ".mwv-tools-panel",
      ".mwv-assets-panel",
      ".mwv-source-panel",
      ".mwv-qr-panel",
      ".mwv-report-panel",
      ".mwv-translate-panel"
    ].forEach((selector) => panel.querySelector<HTMLElement>(selector)?.remove());
  }

  toggleMoreBrowserStatusPanel(panel: HTMLElement, url: string): void {
    const existing = panel.querySelector<HTMLElement>(".mwv-tools-panel");
    if (existing) {
      existing.remove();
      return;
    }
    this.removeMoreUtilityPanels(panel);
    const toolsPanel = panel.createDiv({ cls: "mwv-tools-panel mwv-more-wide-panel" });
    toolsPanel.createDiv({ cls: "mwv-tools-title", text: this.plugin.tr("browserStatus") });
    for (const row of this.plugin.describeBrowserSurface(this.surfaceEl, url)) {
      toolsPanel.createDiv({ cls: "mwv-tools-row", text: row });
    }
  }

  setContextLink(url: string, title = ""): void {
    this.subtitleEl.setText(title ? `${title} · ${hostName(url)}` : url);
    this.addressEl.title = url;
  }

  async openPopupTab(url: string): Promise<void> {
    await this.plugin.addConsole("info", `New tab requested: ${url}`, this.currentUrl);
    await this.newBrowserTab(url);
  }

  openLinkContextMenu(event: MouseEvent, url: string, title: string): void {
    if (!url || !/^https?:\/\//i.test(url)) return;
    event.preventDefault();
    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle(this.plugin.tr("openLink"))
      .setIcon("arrow-right")
      .onClick(() => this.navigate(url, true)));
    menu.addItem((item) => item
      .setTitle(this.plugin.tr("openInNewTab"))
      .setIcon("plus")
      .onClick(() => void this.newBrowserTab(url)));
    menu.addItem((item) => item
      .setTitle(this.plugin.tr("copyLink"))
      .setIcon("copy")
      .onClick(async () => {
        await navigator.clipboard.writeText(`[${title || hostName(url)}](${url})`);
        new Notice(this.tr("copiedLink"));
      }));
    menu.addItem((item) => item
      .setTitle(this.plugin.tr("downloadLink"))
      .setIcon("download")
      .onClick(() => void this.handleSurfaceDownload(url)));
    menu.showAtMouseEvent(event);
  }

  navigate(url: string, pushHistory: boolean): void {
    const nextUrl = normalizeInput(url, this.plugin.settings.searchUrl);
    this.flushCurrentWebNoteBeforeRender();
    this.currentWebNote = undefined;
    const utilityKind = internalUtilityKind(nextUrl);
    if (utilityKind) {
      if (pushHistory && this.currentUrl && this.currentUrl !== nextUrl) {
        this.backStack.push(this.currentUrl);
        this.forwardStack = [];
      }
      this.renderUtilityTab(utilityKind, nextUrl);
      return;
    }
    const query = this.extractBingQuery(nextUrl);
    if (this.isBingHome(nextUrl) || query !== null) {
      if (pushHistory && this.currentUrl && this.currentUrl !== nextUrl) {
        this.backStack.push(this.currentUrl);
        this.forwardStack = [];
      }
      if (query) {
        void this.searchBing(query, nextUrl);
      } else {
        this.showNativeHome(nextUrl);
      }
      return;
    }

    if (pushHistory && this.currentUrl && this.currentUrl !== nextUrl) {
      this.backStack.push(this.currentUrl);
      this.forwardStack = [];
    }

    this.currentUrl = nextUrl;
    this.currentTitle = hostName(nextUrl);
    this.addressEl.value = nextUrl;
    this.titleEl.setText(this.currentTitle);
    this.subtitleEl.setText(this.plugin.tr("readingStatus"));
    this.syncSurfaceIdentity();
    this.plugin.emitApiEvent({ type: "navigate", url: nextUrl, title: this.currentTitle, tabId: this.activeBrowserTabId });
    void this.renderUrlAsNote(nextUrl);
    void this.syncActiveBrowserTab();
    this.renderTabStrip();
    void this.plugin.addHistory({
      title: this.currentTitle,
      url: nextUrl,
      time: Date.now()
    });
  }

  goBack(): void {
    if (this.plugin.isBrowserSurfaceReady(this.surfaceEl) && this.plugin.isElectronWebview(this.surfaceEl) && this.surfaceEl.canGoBack?.()) {
      this.surfaceNavMode = "back";
      this.surfaceEl.goBack?.();
      return;
    }
    const previous = this.backStack.pop();
    if (!previous) {
      new Notice(this.plugin.tr("noPreviousPage"));
      return;
    }
    if (this.currentUrl) this.forwardStack.push(this.currentUrl);
    this.navigateWithoutStack(previous);
  }

  goForward(): void {
    if (this.plugin.isBrowserSurfaceReady(this.surfaceEl) && this.plugin.isElectronWebview(this.surfaceEl) && this.surfaceEl.canGoForward?.()) {
      this.surfaceNavMode = "forward";
      this.surfaceEl.goForward?.();
      return;
    }
    const next = this.forwardStack.pop();
    if (!next) {
      new Notice(this.plugin.tr("noNextPage"));
      return;
    }
    if (this.currentUrl) this.backStack.push(this.currentUrl);
    this.navigateWithoutStack(next);
  }

  navigateWithoutStack(url: string): void {
    this.flushCurrentWebNoteBeforeRender();
    this.currentWebNote = undefined;
    const utilityKind = internalUtilityKind(url);
    if (utilityKind) {
      this.renderUtilityTab(utilityKind, url);
      return;
    }
    const query = this.extractBingQuery(url);
    if (this.isBingHome(url) || query !== null) {
      if (query) {
        void this.searchBing(query, url);
      } else {
        this.showNativeHome(url);
      }
      return;
    }

    this.currentUrl = url;
    this.currentTitle = hostName(url);
    this.addressEl.value = url;
    this.titleEl.setText(this.currentTitle);
    this.subtitleEl.setText(this.plugin.tr("readingStatus"));
    this.syncSurfaceIdentity();
    void this.renderUrlAsNote(url);
    void this.syncActiveBrowserTab();
    this.renderTabStrip();
    void this.plugin.addHistory({
      title: this.currentTitle,
      url,
      time: Date.now()
    });
  }

  reload(): void {
    if (!this.currentUrl) return;
    this.flushCurrentWebNoteBeforeRender();
    const utilityKind = internalUtilityKind(this.currentUrl);
    if (utilityKind) {
      this.renderUtilityTab(utilityKind, this.currentUrl);
      return;
    }
    const query = this.extractBingQuery(this.currentUrl);
    if (this.isBingHome(this.currentUrl) || query !== null) {
      if (query) {
        void this.searchBing(query, this.currentUrl);
      } else {
        this.showNativeHome(this.currentUrl);
      }
      return;
    }
    if (this.plugin.isBrowserSurfaceReady(this.surfaceEl) && this.plugin.isElectronWebview(this.surfaceEl) && this.surfaceEl.reload) {
      this.surfaceNavMode = "reload";
      this.surfaceEl.reload();
      return;
    }
    void this.renderUrlAsNote(this.currentUrl);
  }

  isBingHome(url: string): boolean {
    try {
      const parsed = new URL(url);
      return /(^|\.)bing\.com$/i.test(parsed.hostname) && !parsed.pathname.startsWith("/search");
    } catch {
      return false;
    }
  }

  extractBingQuery(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (/(^|\.)bing\.com$/i.test(parsed.hostname) && parsed.pathname.startsWith("/search")) {
        return parsed.searchParams.get("q") ?? "";
      }
      return null;
    } catch {
      return null;
    }
  }

  showNativeHome(url = this.plugin.settings.homeUrl): void {
    this.flushCurrentWebNoteBeforeRender();
    this.currentUrl = url;
    this.currentTitle = "Bing";
    this.addressEl.value = url;
    this.titleEl.setText("Bing");
    this.subtitleEl.setText(this.plugin.tr("nativeLightHome"));
    this.syncSurfaceIdentity();
    this.setLiveFrameMode(false);
    this.buildHome();
    void this.syncActiveBrowserTab();
    this.renderTabStrip();
    void this.plugin.addHistory({
      title: "Bing",
      url,
      time: Date.now()
    });
  }

  async searchBing(query: string, url?: string): Promise<void> {
    this.flushCurrentWebNoteBeforeRender();
    this.currentWebNote = undefined;
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      this.showNativeHome();
      return;
    }

    const searchUrl = url ?? DEFAULT_SEARCH.replace("{{query}}", encodeURIComponent(cleanQuery));
    this.currentUrl = searchUrl;
    this.currentTitle = `Bing: ${cleanQuery}`;
    this.lastQuery = cleanQuery;
    this.addressEl.value = cleanQuery;
    this.titleEl.setText(this.currentTitle);
    this.subtitleEl.setText(this.plugin.tr("searchingBing"));
    this.syncSurfaceIdentity(searchUrl, this.currentTitle);
    this.setLiveFrameMode(false);
    this.buildHome(cleanQuery, []);
    void this.syncActiveBrowserTab();
    this.renderTabStrip();

    try {
      const results = await this.plugin.searchBing(cleanQuery);
      this.subtitleEl.setText(this.plugin.tr("resultsCount", { count: results.length }));
      this.buildHome(cleanQuery, results);
    } catch (error) {
      console.error("[mobile-webviewer] Bing search failed", error);
      this.subtitleEl.setText("Bing");
      this.buildHome(cleanQuery, fallbackSearchResults(cleanQuery));
    }

    void this.plugin.addHistory({
      title: this.currentTitle,
      url: searchUrl,
      time: Date.now()
    });
  }

  async renderUrlAsNote(url: string): Promise<void> {
    this.setSurfaceUrl(url);
    this.setLiveFrameMode(true);
    this.setFrontendMode(this.plugin.settings.browserFrontendMode || "note");
    this.renderLoadingNote(url);

    try {
      const page = await this.plugin.fetchNotePage(url);
      this.currentTitle = page.title || hostName(url);
      this.titleEl.setText(this.currentTitle);
      this.subtitleEl.setText(page.byline || hostName(url));
      this.syncSurfaceIdentity(page.url, this.currentTitle);
      const note = await this.plugin.ensureWebNote(page);
      this.currentWebNote = note;
      this.renderNotePage(page, note);
      void this.syncActiveBrowserTab();
      this.renderTabStrip();
    } catch (error) {
      console.error("[mobile-webviewer] note render failed", error);
      this.subtitleEl.setText(hostName(url));
      this.setFrontendMode("web");
      void this.plugin.addConsole("warn", "Reader extraction failed; showing live web page", url);
      void this.showReaderFallbackForCurrentPage(url, error instanceof Error ? error.message : "Reader extraction failed");
    }
  }

  renderUtilityTab(kind: UtilityPageKind, url = utilityPageUrl(kind)): void {
    this.currentUrl = url;
    this.currentTitle = utilityPageTitle(kind);
    this.addressEl.value = url;
    this.titleEl.setText(this.currentTitle);
    this.subtitleEl.setText(this.plugin.tr("internalBrowserTab"));
    this.syncSurfaceIdentity(url, this.currentTitle);
    this.setLiveFrameMode(false);
    this.homeEl.removeClass("mwv-reader-strip");
    this.homeEl.addClass("is-visible");
    this.homeEl.empty();
    const article = this.homeEl.createEl("article", { cls: "mwv-note-surface mwv-utility-page" });
    article.dataset.url = url;
    article.createEl("h1", { text: this.currentTitle });
    const actions = article.createDiv({ cls: "mwv-note-actions" });
    const refresh = actions.createEl("button", { attr: { type: "button", title: this.plugin.tr("refresh"), "aria-label": this.plugin.tr("refresh") } });
    setIcon(refresh, "rotate-cw");
    refresh.addEventListener("click", () => this.renderUtilityTab(kind, url));
    if (kind === "cancip") {
      const open = actions.createEl("button", { attr: { type: "button", title: this.plugin.tr("openCancip"), "aria-label": this.plugin.tr("openCancip") } });
      setIcon(open, "bot");
      open.addEventListener("click", () => void this.plugin.openCancip());
    }
    const content = article.createDiv({ cls: "mwv-utility-content" });
    this.renderUtilityContent(content, kind);
    this.queueNoteDrawPageRefresh();
    void this.syncActiveBrowserTab();
    this.renderTabStrip();
  }

  renderUtilityContent(parent: HTMLElement, kind: UtilityPageKind): void {
    if (kind === "downloads") {
      this.renderUtilitySummary(parent, [
        [this.plugin.tr("all"), String(this.plugin.settings.downloads.length)],
        [this.plugin.tr("completed"), String(this.plugin.settings.downloads.filter((entry) => entry.status === "completed").length)],
        [this.plugin.tr("failed"), String(this.plugin.settings.downloads.filter((entry) => entry.status === "error").length)]
      ]);
      this.renderDownloadsList(parent, this.plugin.settings.downloads, true);
      return;
    }
    if (kind === "console") {
      this.renderConsoleList(parent, this.plugin.settings.consoleEntries, true);
      return;
    }
    if (kind === "cancip") {
      this.renderCancipUtility(parent);
      return;
    }
    const entries =
      kind === "bookmarks"
        ? this.plugin.settings.bookmarks.filter((entry) => !isBuiltInShortcut(entry))
        : kind === "reading"
          ? this.plugin.settings.readingList
          : this.plugin.settings.history;
    if (kind === "history") {
      const today = new Date().toDateString();
      this.renderUtilitySummary(parent, [
        [this.plugin.tr("all"), String(entries.length)],
        [this.plugin.tr("today"), String(entries.filter((entry) => new Date(entry.time).toDateString() === today).length)],
        [this.plugin.tr("latest"), entries[0] ? hostName(entries[0].url) : "-"]
      ]);
    }
    this.renderWebEntryList(parent, entries, entries.length ? "" : `No ${utilityPageTitle(kind).toLowerCase()} yet`);
  }

  renderUtilitySummary(parent: HTMLElement, items: [string, string][]): void {
    const summary = parent.createDiv({ cls: "mwv-utility-summary" });
    for (const [label, value] of items) {
      const card = summary.createDiv({ cls: "mwv-utility-summary-card" });
      card.createDiv({ cls: "mwv-utility-summary-label", text: label });
      card.createDiv({ cls: "mwv-utility-summary-value", text: value });
    }
  }

  renderWebEntryList(parent: HTMLElement, entries: WebEntry[], emptyText: string): void {
    if (!entries.length) {
      parent.createDiv({ cls: "mwv-empty", text: emptyText || this.plugin.tr("noEntries") });
      return;
    }
    const list = parent.createDiv({ cls: "mwv-utility-list" });
    for (const entry of entries.slice(0, 120)) {
      const item = list.createDiv({ cls: "mwv-utility-item" });
      const main = item.createEl("button", { cls: "mwv-utility-main", attr: { type: "button", title: entry.url } });
      const meta = main.createDiv({ cls: "mwv-utility-meta" });
      meta.createSpan({ cls: "mwv-utility-host", text: hostName(entry.url) });
      meta.createSpan({ cls: "mwv-utility-time", text: new Date(entry.time).toLocaleString() });
      main.createDiv({ cls: "mwv-utility-title", text: entry.title || hostName(entry.url) });
      main.createDiv({ cls: "mwv-utility-url", text: entry.url });
      main.addEventListener("click", () => void this.newBrowserTab(entry.url));
      const row = item.createDiv({ cls: "mwv-utility-actions" });
      const open = row.createEl("button", { cls: "mwv-mini-action", attr: { type: "button", title: this.plugin.tr("open") } });
      setIcon(open, "arrow-right");
      open.addEventListener("click", () => void this.newBrowserTab(entry.url));
      const copy = row.createEl("button", { cls: "mwv-mini-action", attr: { type: "button", title: this.plugin.tr("copy") } });
      setIcon(copy, "copy");
      copy.addEventListener("click", () => runAsync(async () => {
        await navigator.clipboard.writeText(`[${entry.title || hostName(entry.url)}](${entry.url})`);
        new Notice(this.tr("copiedLink"));
      }));
    }
  }

  renderDownloadsList(parent: HTMLElement, entries: DownloadEntry[], full = false): void {
    const visible = entries.slice(0, full ? 120 : 40);
    if (!visible.length) {
      parent.createDiv({ cls: "mwv-empty", text: this.plugin.tr("noDownloadsYet") });
      return;
    }
    const list = parent.createDiv({ cls: "mwv-download-list" });
    for (const entry of visible) {
      const item = list.createDiv({ cls: `mwv-download-list-item is-${entry.status}` });
      const top = item.createDiv({ cls: "mwv-download-list-top" });
      top.createDiv({ cls: "mwv-download-list-title", text: entry.fileName || hostName(entry.url) });
      top.createDiv({ cls: "mwv-download-list-state", text: this.plugin.tr("downloadState", { status: entry.status, progress: Math.round(entry.progress) }) });
      const progress = item.createDiv({ cls: "mwv-download-progress" });
      progress.createDiv({ cls: "mwv-download-progress-fill", attr: { style: `width:${clampNumber(entry.progress, 0, 100)}%` } });
      item.createDiv({ cls: "mwv-download-list-meta", text: `${entry.connections} connection${entry.connections === 1 ? "" : "s"} · ${entry.resumable ? "Range" : "single"} · ${entry.format.toUpperCase()} · ${new Date(entry.time).toLocaleString()}` });
      item.createDiv({ cls: "mwv-download-list-url", text: entry.url });
      item.createDiv({ cls: "mwv-download-list-path", text: entry.path || entry.message });
      const row = item.createDiv({ cls: "mwv-download-list-actions" });
      const open = row.createEl("button", { cls: "mwv-mini-action", text: this.plugin.tr("openFile"), attr: { type: "button" } });
      open.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.plugin.openDownloadEntry(entry);
      });
      const copy = row.createEl("button", { cls: "mwv-mini-action", text: this.plugin.tr("copyPath"), attr: { type: "button" } });
      copy.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.plugin.copyDownloadPath(entry);
      });
      const locate = row.createEl("button", { cls: "mwv-mini-action", text: this.plugin.tr("location"), attr: { type: "button" } });
      locate.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.plugin.revealDownloadEntry(entry);
      });
      if (entry.url && /^https?:\/\//i.test(entry.url)) {
        const source = row.createEl("button", { cls: "mwv-mini-action", text: this.plugin.tr("source"), attr: { type: "button" } });
        source.addEventListener("click", () => void this.newBrowserTab(entry.url));
      }
    }
  }

  renderConsoleList(parent: HTMLElement, entries: BrowserConsoleEntry[], full = false): void {
    parent.empty();
    const visible = entries.slice(0, full ? 120 : 30);
    if (!visible.length) {
      parent.createDiv({ cls: "mwv-empty", text: this.plugin.tr("noConsoleLogs") });
      return;
    }
    for (const entry of visible) {
      const item = parent.createDiv({ cls: `mwv-console-list-item is-${entry.level}` });
      item.createDiv({ cls: "mwv-console-list-meta", text: `${entry.level.toUpperCase()} · ${new Date(entry.time).toLocaleString()}` });
      item.createDiv({ cls: "mwv-console-list-message", text: entry.message });
      if (entry.url) {
        const url = item.createEl("button", { cls: "mwv-console-list-url", text: entry.url, attr: { type: "button", title: entry.url } });
        const entryUrl = entry.url;
        url.addEventListener("click", () => {
          if (entryUrl) void this.newBrowserTab(entryUrl);
        });
      }
    }
  }

  renderCancipUtility(parent: HTMLElement): void {
    parent.empty();
    const status = this.plugin.getCancipStatus();
    const contextUrl = internalUtilityContextUrl(this.currentUrl) || this.currentUrl || this.plugin.settings.homeUrl;
    const card = parent.createDiv({ cls: "mwv-cancip-card" });
    card.createDiv({ cls: "mwv-cancip-title", text: status.enabled ? this.plugin.tr("cancipDetected") : this.plugin.tr("cancipNotEnabled") });
    card.createDiv({ cls: "mwv-cancip-desc", text: status.enabled ? this.plugin.tr("cancipDetectedDesc", { version: status.version || "unknown" }) : this.plugin.tr("cancipNotEnabledDesc") });
    const row = card.createDiv({ cls: "mwv-utility-actions" });
    const open = row.createEl("button", { cls: "mwv-mini-action", text: this.plugin.tr("openCancip"), attr: { type: "button" } });
    open.disabled = !status.enabled;
    open.addEventListener("click", () => void this.plugin.openCancip());
    const send = row.createEl("button", { cls: "mwv-mini-action", text: this.plugin.tr("sendCurrentToCancip"), attr: { type: "button" } });
    send.disabled = !status.enabled;
    send.addEventListener("click", () => runAsync(async () => {
      await this.plugin.sendCurrentToCancip({ reveal: true, focus: true });
      new Notice(this.plugin.tr("sentCurrentToCancip"));
    }));
    const copy = row.createEl("button", { cls: "mwv-mini-action", text: this.plugin.tr("copyCurrentContext"), attr: { type: "button" } });
    copy.addEventListener("click", () => runAsync(async () => {
      const text = [
        "Mobile Webviewer context",
        `Title: ${hostName(contextUrl)}`,
        `URL: ${contextUrl}`,
        "",
        this.plugin.tr("cancipContextPrompt")
      ].join("\n");
      await navigator.clipboard.writeText(text);
      new Notice(this.plugin.tr("copiedCancipContext"));
    }));
  }

  async showReaderFallbackForCurrentPage(url: string, reason = ""): Promise<void> {
    const nextUrl = normalizeInput(url || this.currentUrl || this.plugin.settings.homeUrl, this.plugin.settings.searchUrl);
    if (!nextUrl || !this.homeEl?.isConnected) return;
    try {
      const page = await this.plugin.fetchFallbackNotePage(nextUrl, reason);
      if (!this.homeEl?.isConnected || (this.currentUrl && normalizeInput(this.currentUrl, this.plugin.settings.searchUrl) !== nextUrl)) return;
      const note = await this.plugin.ensureWebNote(page);
      this.currentWebNote = note;
      this.currentTitle = page.title || hostName(nextUrl);
      this.titleEl.setText(this.currentTitle);
      this.subtitleEl.setText(reason || page.byline || hostName(nextUrl));
      this.renderNotePage(page, note);
      this.setFrontendMode(this.frontendMode === "web" ? "split" : this.frontendMode);
    } catch (error) {
      console.error("[mobile-webviewer] reader fallback failed", error);
    }
  }

  setLiveFrameMode(enabled: boolean): void {
    const wrap = this.surfaceEl.parentElement;
    const root = this.containerEl.children[1] as HTMLElement | undefined;
    wrap?.toggleClass("is-live-page", enabled);
    wrap?.toggleClass("is-note-front", enabled && this.frontendMode === "note");
    wrap?.toggleClass("is-web-front", enabled && this.frontendMode === "web");
    wrap?.toggleClass("is-split-front", enabled && this.frontendMode === "split");
    this.homeEl.toggleClass("mwv-reader-strip", enabled);
    if (root) this.plugin.applyBrowserRuntimeClasses(root);
    this.homeEl.toggleClass("is-visible", !enabled || this.frontendMode !== "web");
    if (enabled) {
      this.surfaceEl.removeClass("is-hidden");
    } else {
      root?.removeClass("is-raw-web");
      root?.removeAttribute("data-notedraw-ignore");
      this.plugin.setBrowserSurfaceUrl(this.surfaceEl, "about:blank");
      this.surfaceEl.addClass("is-hidden");
      this.homeEl.removeClass("mwv-reader-strip");
    }
  }

  setFrontendMode(mode: "note" | "web" | "split"): void {
    this.frontendMode = mode;
    this.plugin.settings.browserFrontendMode = mode;
    void this.plugin.saveSettings();
    const wrap = this.surfaceEl?.parentElement;
    if (!wrap) return;
    const root = this.containerEl.children[1] as HTMLElement | undefined;
    if (root) this.plugin.applyBrowserRuntimeClasses(root);
    wrap.toggleClass("is-note-front", mode === "note");
    wrap.toggleClass("is-web-front", mode === "web");
    wrap.toggleClass("is-split-front", mode === "split");
    this.homeEl.toggleClass("mwv-reader-strip", mode !== "web");
    this.surfaceEl.toggleClass("is-hidden", mode === "note");
    this.homeEl.toggleClass("is-visible", mode !== "web");
    this.containerEl.querySelectorAll<HTMLElement>("[data-mwv-mode]").forEach((button) => {
      button.toggleClass("is-active", button.dataset.mwvMode === mode);
    });
  }

  renderLoadingNote(url: string): void {
    this.finishActiveDoodle();
    this.homeEl.empty();
    const article = this.homeEl.createEl("article", { cls: "mwv-note-surface" });
    article.createDiv({ cls: "mwv-note-source", text: hostName(url) });
    article.createEl("h1", { text: this.plugin.tr("reader") });
    article.createEl("p", { text: url });
  }

  renderErrorNote(url: string): void {
    this.flushCurrentWebNoteBeforeRender();
    this.setLiveFrameMode(true);
    this.homeEl.empty();
    const article = this.homeEl.createEl("article", { cls: "mwv-note-surface" });
    article.createDiv({ cls: "mwv-note-source", text: hostName(url) });
    article.createEl("h1", { text: this.plugin.tr("pageTools") });
    const actions = article.createDiv({ cls: "mwv-note-actions" });
    const copyButton = actions.createEl("button", { text: this.plugin.tr("copyLink"), attr: { type: "button" } });
    copyButton.addEventListener("click", () => runAsync(async () => {
      await navigator.clipboard.writeText(url);
      new Notice(this.tr("copiedLink"));
    }));
  }

  renderNotePage(page: NotePage, note?: WebNoteEntry): void {
    this.finishActiveDoodle();
    this.homeEl.empty();
    const article = this.homeEl.createEl("article", { cls: "mwv-note-surface" });
    article.dataset.url = page.url;
    article.createDiv({ cls: "mwv-note-source", text: page.byline || hostName(page.url) });
    article.createEl("h1", { text: page.title || hostName(page.url) });

    const actions = article.createDiv({ cls: "mwv-note-actions" });
    const copyButton = actions.createEl("button", { text: this.plugin.tr("copyLink"), attr: { type: "button" } });
    copyButton.addEventListener("click", () => runAsync(async () => {
      await navigator.clipboard.writeText(`[${page.title}](${page.url})`);
      new Notice(this.tr("copiedLink"));
    }));
    const doodleButton = actions.createEl("button", {
      cls: "mwv-note-action-icon",
      attr: { type: "button", title: this.plugin.tr("doodle"), "aria-label": this.plugin.tr("doodle") }
    });
    setIcon(doodleButton, "pen-line");
    doodleButton.dataset.mwvDoodleToggle = "true";
    doodleButton.setAttribute("aria-pressed", "false");
    doodleButton.addEventListener("click", () => this.toggleDoodleLayer(article, doodleButton));
    const status = actions.createSpan({ cls: "mwv-webnote-status" });

    const noteWrap = article.createDiv({ cls: "mwv-webnote-wrap" });
    const content = noteWrap.createDiv({
      cls: "mwv-note-content mwv-webnote-editor",
      attr: {
        contenteditable: "true",
        spellcheck: "true",
        "aria-label": this.plugin.tr("editableWebNote")
      }
    });
    this.populateWebNoteContent(content, page, note);
    const doodleLayer = content.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
    doodleLayer.addClass("mwv-doodle-layer");
    doodleLayer.setAttribute("viewBox", "0 0 1000 1000");
    doodleLayer.setAttribute("preserveAspectRatio", "none");
    doodleLayer.setAttribute("aria-hidden", "true");
    noteWrap.appendChild(doodleLayer);
    if (note?.doodleSvg) {
      appendSafeDoodleSvg(doodleLayer, note.doodleSvg);
    }
    this.bindWebNoteEditor(content, status);
    this.bindDoodleLayer(doodleLayer, status);
    this.plugin.applyReaderCustomizations(article, page);

    if (page.links.length) {
      const related = article.createDiv({ cls: "mwv-note-related" });
      related.createEl("h2", { text: this.plugin.tr("links") });
      for (const link of page.links.slice(0, 8)) {
        const button = related.createEl("button", { cls: "mwv-note-link", attr: { type: "button" } });
        button.createDiv({ cls: "mwv-note-link-title", text: link.title });
        button.createDiv({ cls: "mwv-note-link-url", text: link.url });
        button.addEventListener("click", () => this.navigate(link.url, true));
      }
    }
    if (this.frontendMode) {
      this.setFrontendMode(this.frontendMode);
    }
    this.queueNoteDrawPageRefresh();
  }

  populateWebNoteContent(content: HTMLElement, page: NotePage, note?: WebNoteEntry): void {
    if (note?.noteHtml) {
      appendSafeHtml(content, note.noteHtml);
      return;
    }
    const blocks = page.content.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    if (!blocks.length && page.excerpt) {
      content.createEl("p", { text: page.excerpt });
      return;
    }
    for (const block of blocks.slice(0, 100)) {
      if (/^#{1,3}\s+/.test(block)) {
        const level = Math.min(3, block.match(/^#+/)?.[0].length ?? 2);
        content.createEl(`h${level}` as keyof HTMLElementTagNameMap, { text: block.replace(/^#{1,3}\s+/, "") });
      } else {
        content.createEl("p", { text: block });
      }
    }
  }

  bindWebNoteEditor(content: HTMLElement, status: HTMLElement): void {
    const markDirty = () => {
      status.setText("");
      this.queueWebNoteSave(status);
    };
    content.addEventListener("input", markDirty, true);
    content.addEventListener("keyup", markDirty, true);
    content.addEventListener("compositionend", markDirty, true);
    content.addEventListener("paste", () => window.setTimeout(markDirty, 0), true);
    content.addEventListener("blur", () => void this.saveCurrentWebNoteNow(status));
  }

  queueWebNoteSave(status?: HTMLElement): void {
    if (!this.plugin.settings.autoSaveWebNotes) return;
    if (this.webNoteSaveTimer) window.clearTimeout(this.webNoteSaveTimer);
    this.webNoteSaveTimer = window.setTimeout(() => {
      void this.saveCurrentWebNote(false, status);
    }, 700);
  }

  queueWebNoteDoodleSave(status?: HTMLElement): void {
    if (!this.plugin.settings.autoSaveWebNotes) return;
    if (this.webNoteDoodleSaveTimer) window.clearTimeout(this.webNoteDoodleSaveTimer);
    this.webNoteDoodleSaveTimer = window.setTimeout(() => {
      this.webNoteDoodleSaveTimer = undefined;
      void this.saveCurrentWebNote(false, status);
    }, 220);
  }

  async saveCurrentWebNoteNow(status?: HTMLElement): Promise<WebNoteEntry | undefined> {
    this.finishActiveDoodle();
    if (this.webNoteSaveTimer) {
      window.clearTimeout(this.webNoteSaveTimer);
      this.webNoteSaveTimer = undefined;
    }
    if (this.webNoteDoodleSaveTimer) {
      window.clearTimeout(this.webNoteDoodleSaveTimer);
      this.webNoteDoodleSaveTimer = undefined;
    }
    return await this.saveCurrentWebNote(false, status);
  }

  async saveCurrentWebNote(showNotice = false, status?: HTMLElement): Promise<WebNoteEntry | undefined> {
    if (!this.currentUrl) return undefined;
    const article = this.homeEl.querySelector<HTMLElement>(".mwv-note-surface");
    const editor = article?.querySelector<HTMLElement>(".mwv-webnote-editor");
    if (!article || !editor) return undefined;
    const doodle = article.querySelector<SVGSVGElement>(".mwv-doodle-layer");
    const base = this.currentWebNote ?? this.plugin.createWebNoteFromPage({
      title: this.currentTitle || hostName(this.currentUrl),
      url: this.currentUrl,
      byline: hostName(this.currentUrl),
      excerpt: editor.innerText.slice(0, 420),
      content: editor.innerText,
      images: [],
      links: []
    });
    const updated: WebNoteEntry = {
      ...base,
      title: this.currentTitle || base.title,
      noteHtml: editor.innerHTML,
      noteText: htmlToMarkdownFromElement(editor),
      doodleSvg: doodle?.innerHTML ?? "",
      updatedAt: Date.now()
    };
    this.currentWebNote = await this.plugin.saveWebNote(updated);
    status?.setText("");
    if (showNotice) new Notice(this.plugin.tr("webNoteSaved"));
    return this.currentWebNote;
  }

  async exportCurrentWebNote(status?: HTMLElement): Promise<void> {
    const saved = await this.saveCurrentWebNote(false, status);
    if (!saved) return;
    const exported = await this.plugin.exportWebNoteMarkdown(saved);
    this.currentWebNote = exported;
    status?.setText("");
    new Notice(this.tr("savedTo", { path: exported.markdownPath }));
  }

  async openCurrentInNoteBrowser(): Promise<void> {
    const status = this.homeEl?.querySelector<HTMLElement>(".mwv-webnote-status") ?? undefined;
    await this.saveCurrentWebNote(false, status);
    // Opening the Markdown NoteWeb from a standalone browser leaf used to
    // leave the old WebView/NoteDraw header proxy behind in the workspace.
    // Sweep that plugin-owned residue before the new note leaf is rendered.
    this.plugin.disposeAllRawNoteDrawControllers();
    this.plugin.cleanupStaleNoteDrawButtonResidue(this.containerEl.closest<HTMLElement>(".workspace-leaf-content") ?? this.containerEl);
    await this.plugin.openNoteBrowser(this.currentUrl || this.plugin.settings.homeUrl);
  }

  setDoodleToggleState(button: HTMLButtonElement, enabled: boolean): void {
    button.toggleClass("is-active", enabled);
    button.setAttribute("aria-pressed", enabled ? "true" : "false");
    button.setAttribute("title", enabled ? this.plugin.tr("closeDoodle") : this.plugin.tr("doodle"));
    button.setAttribute("aria-label", enabled ? this.plugin.tr("closeDoodle") : this.plugin.tr("doodle"));
  }

  resetDoodleControls(root: ParentNode): void {
    this.finishActiveDoodle();
    root.querySelectorAll<HTMLElement>(".mwv-note-surface.is-doodling, .mwv-reader-panel.is-doodling").forEach((surface) => {
      surface.removeClass("is-doodling");
    });
    root.querySelectorAll<HTMLButtonElement>("[data-mwv-doodle-toggle]").forEach((button) => {
      this.setDoodleToggleState(button, false);
    });
  }

  flushCurrentWebNoteBeforeRender(): void {
    const status = this.homeEl?.querySelector<HTMLElement>(".mwv-webnote-status") ?? undefined;
    this.resetDoodleControls(this.homeEl);
    if (this.webNoteSaveTimer) {
      window.clearTimeout(this.webNoteSaveTimer);
      this.webNoteSaveTimer = undefined;
    }
    if (this.webNoteDoodleSaveTimer) {
      window.clearTimeout(this.webNoteDoodleSaveTimer);
      this.webNoteDoodleSaveTimer = undefined;
    }
    void this.saveCurrentWebNoteNow(status);
  }

  toggleDoodleLayer(article: HTMLElement, button: HTMLButtonElement): void {
    const enabled = !article.hasClass("is-doodling");
    this.finishActiveDoodle();
    this.homeEl.querySelectorAll<HTMLElement>(".mwv-note-surface.is-doodling").forEach((surface) => {
      if (surface !== article) surface.removeClass("is-doodling");
    });
    this.homeEl.querySelectorAll<HTMLButtonElement>("[data-mwv-doodle-toggle]").forEach((toggle) => {
      if (toggle !== button) this.setDoodleToggleState(toggle, false);
    });
    article.toggleClass("is-doodling", enabled);
    this.setDoodleToggleState(button, enabled);
    if (!enabled) {
      const status = article.querySelector<HTMLElement>(".mwv-webnote-status");
      void this.saveCurrentWebNoteNow(status ?? undefined);
    }
  }

  finishActiveDoodle(event?: PointerEvent): void {
    const svg = this.activeDoodleSvg;
    const pointerId = this.activeDoodlePointerId ?? event?.pointerId;
    this.activeDoodlePath = undefined;
    this.activeDoodlePointerId = undefined;
    this.activeDoodleSvg = undefined;
    if (svg?.isConnected && typeof pointerId === "number") {
      try {
        if (svg.hasPointerCapture?.(pointerId)) {
          svg.releasePointerCapture(pointerId);
        }
      } catch {
        // The host may already have released the pointer capture.
      }
    }
  }

  bindDoodleLayer(svg: SVGSVGElement, status: HTMLElement): void {
    const isEnabled = () => Boolean(svg.closest<HTMLElement>(".mwv-note-surface")?.hasClass("is-doodling"));
    const point = (event: PointerEvent): [number, number] => {
      const rect = svg.getBoundingClientRect();
      const x = clampNumber(((event.clientX - rect.left) / Math.max(1, rect.width)) * 1000, 0, 1000);
      const y = clampNumber(((event.clientY - rect.top) / Math.max(1, rect.height)) * 1000, 0, 1000);
      return [x, y];
    };
    svg.addEventListener("pointerdown", (event) => {
      if (!isEnabled()) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (this.activeDoodlePath) {
        this.finishActiveDoodle(event);
        this.queueWebNoteSave(status);
      }
      const [x, y] = point(event);
      const path = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${x.toFixed(1)} ${y.toFixed(1)}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "var(--interactive-accent)");
      path.setAttribute("stroke-width", "5");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      svg.appendChild(path);
      this.activeDoodlePath = path;
      this.activeDoodlePointerId = event.pointerId;
      this.activeDoodleSvg = svg;
      try {
        svg.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is unavailable in some mobile hosts.
      }
    });
    svg.addEventListener("pointermove", (event) => {
      if (
        !isEnabled() ||
        !this.activeDoodlePath ||
        this.activeDoodlePath.ownerSVGElement !== svg ||
        this.activeDoodlePointerId !== event.pointerId
      ) return;
      event.preventDefault();
      event.stopPropagation();
      const [x, y] = point(event);
      this.activeDoodlePath.setAttribute("d", `${this.activeDoodlePath.getAttribute("d")} L ${x.toFixed(1)} ${y.toFixed(1)}`);
      status.setText("");
      this.queueWebNoteDoodleSave(status);
    });
    const finish = (event: PointerEvent) => {
      if (!this.activeDoodlePath || this.activeDoodlePath.ownerSVGElement !== svg) return;
      this.finishActiveDoodle(event);
      void this.saveCurrentWebNoteNow(status);
    };
    svg.addEventListener("pointerup", finish);
    svg.addEventListener("pointercancel", finish);
    svg.addEventListener("pointerleave", finish);
    svg.addEventListener("lostpointercapture", (event) => {
      if (!this.activeDoodlePath || this.activeDoodlePath.ownerSVGElement !== svg) return;
      this.finishActiveDoodle(event);
      void this.saveCurrentWebNoteNow(status);
    });
    this.registerDomEvent(window, "pointerup", (event) => {
      if (!this.activeDoodlePath || this.activeDoodlePath.ownerSVGElement !== svg) return;
      this.finishActiveDoodle(event);
      void this.saveCurrentWebNoteNow(status);
    });
    this.registerDomEvent(window, "pointercancel", (event) => {
      if (!this.activeDoodlePath || this.activeDoodlePath.ownerSVGElement !== svg) return;
      this.finishActiveDoodle(event);
      void this.saveCurrentWebNoteNow(status);
    });
    this.registerDomEvent(window, "blur", () => {
      if (!this.activeDoodlePath || this.activeDoodlePath.ownerSVGElement !== svg) return;
      this.finishActiveDoodle();
      void this.saveCurrentWebNoteNow(status);
    });
  }

  async toggleBookmark(): Promise<void> {
    if (!this.currentUrl) return;
    const added = await this.plugin.toggleBookmarkEntry(this.currentUrl, this.currentTitle || hostName(this.currentUrl));
    new Notice(added ? this.tr("bookmarkAdded") : this.tr("bookmarkRemoved"));
    this.renderDrawer(this.currentDrawer);
  }

  openMoreMenu(anchor: HTMLElement): void {
    const url = this.currentUrl || this.plugin.settings.homeUrl;
    const title = this.currentTitle || hostName(url);
    if (this.morePanelEl) {
      this.closeMorePanel();
      return;
    }
    this.closeDrawer();

    const root = this.containerEl.children[1] as HTMLElement;
    const panel = root.createDiv({ cls: "mwv-more-panel" });
    this.morePanelEl = panel;

    const head = panel.createDiv({ cls: "mwv-more-head" });
    head.createDiv({ cls: "mwv-more-title", text: this.plugin.tr("more") });
    const close = head.createEl("button", { cls: "mwv-more-close", attr: { type: "button", "aria-label": this.plugin.tr("closeMore") } });
    setIcon(close, "x");
    close.addEventListener("click", () => this.closeMorePanel());

    const body = panel.createDiv({ cls: "mwv-more-body" });
    const feedback = body.createDiv({
      cls: "mwv-more-feedback",
      text: this.plugin.tr("downloadSavedTo", { folder: this.plugin.normalizeDownloadFolder() })
    });
    const sections = body.createDiv({ cls: "mwv-more-sections" });
    const setFeedback = (message: string, isError = false) => {
      feedback.setText(message);
      feedback.toggleClass("is-error", isError);
    };
    const addGroup = (title: string): HTMLElement => {
      const section = sections.createDiv({ cls: "mwv-more-section" });
      section.createDiv({ cls: "mwv-more-section-title", text: title });
      return section.createDiv({ cls: "mwv-more-actions" });
    };
    const tabActions = addGroup(this.plugin.tr("tabs"));
    const pageActions = addGroup(this.plugin.tr("page"));
    const viewActions = addGroup(this.plugin.tr("view"));
    const saveActions = addGroup(this.plugin.tr("save"));
    const toolActions = addGroup(this.plugin.tr("tools"));
    const addAction = (group: HTMLElement, icon: string, label: string, onClick: () => void | Promise<void>): HTMLButtonElement => {
      const button = group.createEl("button", { cls: "mwv-more-action", attr: { type: "button", title: label } });
      setIcon(button, icon);
      button.createSpan({ text: label });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.disabled = true;
        setFeedback(this.plugin.tr("runningAction", { label }));
        runActionWithFeedback(
          onClick,
          () => setFeedback(this.plugin.tr("completedAction", { label })),
          (error) => {
            const message = error instanceof Error ? error.message : String(error);
            setFeedback(this.plugin.tr("failedAction", { label, message }), true);
            void this.plugin.addConsole("error", `${label} failed: ${message}`, url);
            new Notice(`${label} failed`);
          },
          () => {
            button.disabled = false;
          }
        );
      });
      return button;
    };

    addAction(tabActions, "download", this.plugin.tr("downloadsCount", { count: this.plugin.settings.downloads.length }), () => void this.openUtilityTab("downloads"));
    addAction(tabActions, "history", this.plugin.tr("historyCount", { count: this.plugin.settings.history.length }), () => void this.openUtilityTab("history"));
    addAction(tabActions, "book-open", this.plugin.tr("bookmarksCount", { count: this.plugin.settings.bookmarks.length }), () => void this.openUtilityTab("bookmarks"));
    addAction(tabActions, "library", this.plugin.tr("readingCount", { count: this.plugin.settings.readingList.length }), () => void this.openUtilityTab("reading"));
    addAction(tabActions, "terminal", this.plugin.tr("consoleCount", { count: this.plugin.settings.consoleEntries.length }), () => void this.openUtilityTab("console"));
    addAction(tabActions, "bot", "Cancip AI", () => void this.openUtilityTab("cancip"));
    addAction(tabActions, "plus", this.plugin.tr("newObTab"), () => void this.newBrowserTab());
    addAction(tabActions, "file-text", this.plugin.tr("openNoteWeb"), () => runAsync(async () => {
      this.closeMorePanel();
      await this.plugin.openNoteBrowser(url);
    }));

    addAction(pageActions, "external-link", this.plugin.tr("openInBrowser"), () => {
      void this.plugin.openNoteBrowser(url, true);
    });
    addAction(pageActions, "copy", this.plugin.tr("copyLink"), () => runAsync(async () => {
      await navigator.clipboard.writeText(`[${title}](${url})`);
      new Notice(this.tr("copiedLink"));
    }));
    addAction(pageActions, "share-2", this.plugin.tr("share"), () => this.plugin.sharePage(url, title));
    addAction(pageActions, "app-window", this.plugin.tr("systemBrowser"), () => this.plugin.openInSystemBrowser(url));
    addAction(pageActions, "cookie", this.plugin.tr("clearCookies"), async () => {
      await this.plugin.clearProxyCookies();
      new Notice(this.plugin.tr("cookiesCleared"));
    });
    addAction(pageActions, "activity", this.plugin.tr("browserStatus"), () => this.toggleMoreBrowserStatusPanel(body, url));

    addAction(viewActions, "zoom-in", this.plugin.tr("zoomIn", { value: this.plugin.settings.pageZoom }), () => this.plugin.setPageZoom(this.plugin.settings.pageZoom + 10, this.containerEl));
    addAction(viewActions, "zoom-out", this.plugin.tr("zoomOut"), () => this.plugin.setPageZoom(this.plugin.settings.pageZoom - 10, this.containerEl));
    addAction(viewActions, "monitor-smartphone", this.plugin.settings.desktopMode ? this.plugin.tr("mobileVersion") : this.plugin.tr("desktopVersion"), () => this.plugin.toggleDesktopMode(this.containerEl));
    addAction(viewActions, "moon", this.plugin.settings.nightMode ? this.plugin.tr("dayMode") : this.plugin.tr("nightMode"), () => this.plugin.toggleBooleanMode("nightMode", this.containerEl, "Night mode"));
    addAction(viewActions, "eye", this.plugin.settings.eyeProtectionMode ? this.plugin.tr("closeEyeProtection") : this.plugin.tr("eyeProtection"), () => this.plugin.toggleBooleanMode("eyeProtectionMode", this.containerEl, "Eye mode"));
    addAction(viewActions, "shield-check", this.plugin.settings.adBlockEnabled ? this.plugin.tr("closeAdBlock") : this.plugin.tr("adBlocking"), async () => {
      await this.plugin.setAdMode(!this.plugin.settings.adBlockEnabled, false, this.containerEl);
      this.reload();
    });
    addAction(viewActions, "scan", this.plugin.settings.markAdsEnabled ? this.plugin.tr("unmarkAds") : this.plugin.tr("markAds"), async () => {
      await this.plugin.setAdMode(false, !this.plugin.settings.markAdsEnabled, this.containerEl);
      this.reload();
    });
    addAction(viewActions, "glasses", this.plugin.settings.incognitoMode ? this.plugin.tr("closeIncognito") : this.plugin.tr("incognito"), () => this.plugin.toggleBooleanMode("incognitoMode", this.containerEl, "Incognito"));
    addAction(viewActions, "maximize", this.plugin.settings.fullScreenMode ? this.plugin.tr("exitFullscreen") : this.plugin.tr("fullscreen"), () => this.plugin.toggleFullscreen(this.containerEl));
    addAction(viewActions, "file-x", this.plugin.settings.jsDisabled ? this.plugin.tr("enableJs") : this.plugin.tr("disableJs"), async () => {
      await this.plugin.toggleBooleanMode("jsDisabled", this.containerEl, "JavaScript");
      this.reload();
    });
    addAction(viewActions, "smartphone", `UA: ${this.plugin.settings.userAgentMode}`, async () => {
      await this.plugin.toggleUserAgent(this.containerEl);
      this.reload();
    });
    addAction(viewActions, "rotate-cw", this.plugin.settings.rotatedMode ? this.plugin.tr("closeLandscape") : this.plugin.tr("landscape"), () => this.plugin.toggleBooleanMode("rotatedMode", this.containerEl, "Rotate"));
    addAction(viewActions, "type", this.plugin.tr("fontSize", { value: this.plugin.settings.readerFontScale }), () => this.plugin.adjustReaderFont(10, this.containerEl));

    addAction(saveActions, "download", this.plugin.tr("downloadFile"), async () => {
      const entry = await this.plugin.downloadUrlFile(url);
      setFeedback(this.plugin.tr("downloadFinished", { path: entry.path || entry.message }));
      this.closeMorePanel();
      await this.openUtilityTab("downloads");
    });
    addAction(saveActions, "file-code", this.plugin.tr("saveHtml"), async () => {
      const entry = await this.plugin.downloadCurrentPageHtml(url, title);
      setFeedback(this.plugin.tr("saved", { path: entry.path || entry.message }));
      this.closeMorePanel();
      await this.openUtilityTab("downloads");
    });
    addAction(saveActions, "archive", this.plugin.tr("saveMht"), async () => {
      const entry = await this.plugin.downloadCurrentPageMhtml(url, title);
      setFeedback(this.plugin.tr("saved", { path: entry.path || entry.message }));
      this.closeMorePanel();
      await this.openUtilityTab("downloads");
    });
    addAction(saveActions, "file-down", this.plugin.tr("offlinePage"), async () => {
      await this.plugin.saveOfflinePage(url, title);
      this.closeMorePanel();
      await this.openUtilityTab("downloads");
    });
    addAction(saveActions, "file-symlink", this.plugin.tr("desktopShortcut"), async () => {
      const path = await this.plugin.createShortcutFile(url, title);
      setFeedback(this.plugin.tr("saved", { path }));
      new Notice(this.plugin.tr("saved", { path }));
    });
    addAction(saveActions, "star", this.plugin.settings.bookmarks.some((entry) => entry.url === url) ? this.plugin.tr("removeBookmark") : this.plugin.tr("addBookmark"), () => this.toggleBookmark());
    addAction(saveActions, "book-open", this.plugin.tr("addReadingList"), async () => {
      await this.plugin.addReadingList({ title, url, time: Date.now() });
      this.renderDrawer(this.currentDrawer);
      new Notice(this.plugin.tr("addedReadingList"));
    });

    addAction(toolActions, "text-cursor-input", this.plugin.tr("autofillPage"), () => this.autofillCurrentPage());
    addAction(toolActions, "wand-sparkles", this.plugin.tr("scriptsCount", { count: this.plugin.getActiveUserScriptRules(url).length }), () => {
      this.plugin.toggleUserScriptsPanel(body, url);
    });
    addAction(toolActions, "radio", this.plugin.tr("mediaSniff"), async () => {
      const assets = await this.plugin.extractPageAssets(url);
      await navigator.clipboard.writeText(assets.media.join("\n"));
      new Notice(this.plugin.tr("mediaCopied", { count: assets.media.length }));
    });
    addAction(toolActions, "layers", this.plugin.tr("pageAssets"), async () => {
      const assets = await this.plugin.extractPageAssets(url);
      await navigator.clipboard.writeText([...assets.links, ...assets.media, ...assets.scripts, ...assets.styles].join("\n"));
      new Notice(this.plugin.tr("resourcesCopied"));
    });
    addAction(toolActions, "code-2", this.plugin.tr("copySource"), async () => {
      const assets = await this.plugin.extractPageAssets(url);
      await navigator.clipboard.writeText(assets.html);
      new Notice(this.plugin.tr("sourceCopied"));
    });
    addAction(toolActions, "languages", `${this.plugin.tr("translateAction")} (${translateModeLabel(this.plugin.settings.translateTarget)})`, () => {
      new TranslateLanguageModal(this.app, this.plugin, url, (translateUrl) => this.navigate(translateUrl, true)).open();
    });
    addAction(toolActions, "volume-2", this.plugin.tr("readAloud"), () => this.plugin.readPageAloud(url));
    addAction(toolActions, "qr-code", this.plugin.tr("qrCode"), () => this.plugin.toggleQrPanel(body, url));
    addAction(toolActions, "shield-alert", this.plugin.tr("report"), () => this.plugin.toggleReportPanel(body, url));
    addAction(toolActions, "copy", this.plugin.tr("copyLogs"), async () => {
      await navigator.clipboard.writeText(this.plugin.formatConsoleEntries());
      new Notice(this.plugin.tr("consoleCopied"));
    });
    addAction(toolActions, "trash", this.plugin.tr("clearCache", { count: this.plugin.settings.pageCache.length }), async () => {
      await this.plugin.clearCache();
      new Notice(this.plugin.tr("cacheCleared"));
    });
    addAction(toolActions, "settings", this.plugin.tr("settings"), () => this.plugin.openSettings());
  }

  async openUtilityTab(kind: UtilityPageKind): Promise<void> {
    this.closeMorePanel();
    const contextUrl = kind === "cancip" ? this.currentUrl : "";
    await this.newBrowserTab(utilityPageUrl(kind, contextUrl));
  }

  async autofillCurrentPage(): Promise<void> {
    const count = await this.plugin.autofillFrame(this.surfaceEl, this.currentUrl);
    if (count) new Notice(`Autofilled ${count} field(s)`);
  }

  toggleFindPanel(): void {
    if (this.findPanelEl?.isConnected) {
      this.findPanelEl.remove();
      this.findPanelEl = undefined;
      this.plugin.clearFindMarks(this.containerEl);
      return;
    }

    const panel = this.containerEl.createDiv({ cls: "mwv-find-panel" });
    this.findPanelEl = panel;
    const input = panel.createEl("input", {
      cls: "mwv-find-input",
      attr: { type: "search", placeholder: this.tr("findInPage"), autocomplete: "off" }
    });
    const prev = panel.createEl("button", { cls: "mwv-find-button", attr: { type: "button", title: this.tr("previous") } });
    setIcon(prev, "chevron-up");
    const next = panel.createEl("button", { cls: "mwv-find-button", attr: { type: "button", title: this.tr("next") } });
    setIcon(next, "chevron-down");
    const close = panel.createEl("button", { cls: "mwv-find-button", attr: { type: "button", title: this.tr("close") } });
    setIcon(close, "x");
    const status = panel.createDiv({ cls: "mwv-find-status", text: "0" });

    const run = async (direction = 1) => {
      const query = input.value.trim();
      const count = await this.plugin.findInTargets(query, this.containerEl, this.surfaceEl, direction);
      status.setText(query ? String(count) : "0");
    };
    input.addEventListener("input", () => void run(1));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void run(event.shiftKey ? -1 : 1);
      }
    });
    prev.addEventListener("click", () => void run(-1));
    next.addEventListener("click", () => void run(1));
    close.addEventListener("click", () => {
      panel.remove();
      this.findPanelEl = undefined;
      this.plugin.clearFindMarks(this.containerEl);
    });
    input.focus();
  }

  async captureLink(): Promise<void> {
    if (!this.currentUrl) return;
    const title = this.currentTitle || hostName(this.currentUrl);
    const markdown = `[${title.replace(/\]/g, "\\]")}](${this.currentUrl})`;
    const active = this.app.workspace.getActiveFile();
    if (active instanceof TFile && active.extension === "md") {
      const editor = this.app.workspace.activeEditor?.editor;
      if (editor) {
        editor.replaceSelection(markdown);
        new Notice(this.plugin.tr("insertedLink"));
        return;
      }
    }

    await navigator.clipboard.writeText(markdown);
    new Notice(this.plugin.tr("copiedMarkdownLink"));
  }

  triggerNoteDraw(): void {
    this.app.workspace.setActiveLeaf(this.leaf, { focus: true });
    this.plugin.triggerNoteDraw(this.containerEl);
  }

  openUrl(url: string): void {
    this.navigate(url, true);
  }
}

export default class MobileWebviewerPlugin extends Plugin {
  disposed = false;
  settings: MobileWebviewerSettings = DEFAULT_SETTINGS;
  processorSeq = 0;
  processorSessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  embedRenderTokens = new WeakMap<HTMLElement, number>();
  embedRenderSeq = 0;
  noteDrawDedupeTimers = new WeakMap<HTMLElement, number>();
  noteDrawDrawingSaveTimers = new WeakMap<NoteDrawControllerLike, number>();
  noteDrawControllerRepairs = new WeakSet<HTMLElement>();
  noteDrawControllerRestoreTokens = new WeakMap<HTMLElement, number>();
  noteDrawControllerRestoreSeq = 0;
  noteWebRawEditingSeq = 0;
  noteDrawHeaderActivationTokens = new WeakMap<HTMLElement, number>();
  noteDrawHeaderActivationSeq = 0;
  noteDrawLegacyMigrationTimer = 0;
  noteDrawLegacyMigrationPromise: Promise<boolean> | null = null;
  noteDrawLegacyMigrationRetry = 0;
  /**
   * NoteDraw has a global MutationObserver which scans every webview-like
   * surface.  Raw browser surfaces must be excluded before that scan mounts a
   * controller; hiding/removing the resulting toolbar afterwards is too late
   * and can already have changed the guest page's host layout.
   */
  noteDrawRawSurfaceGuardPlugin: NoteDrawPluginLike | null = null;
  noteDrawRawSurfaceGuardOriginal: (() => void) | null = null;
  noteDrawRawSurfaceGuardWrapper: (() => void) | null = null;
  noteDrawRawSurfaceGuardMethodPatches: Array<{
    plugin: NoteDrawPluginLike;
    key: "syncRenderedMarkdownAnnotations" | "syncSourceControllers" | "syncMarkdownControllerModes" | "syncEmbeddedMarkdownControllers";
    original: (...args: unknown[]) => unknown;
    wrapper: (...args: unknown[]) => unknown;
  }> = [];
  noteDrawRawSurfaceGuardRetryTimers: number[] = [];
  noteDrawRawSurfaceGuardRunning = false;
  noteBrowserNativeBindings = new WeakMap<WorkspaceLeaf, NoteBrowserNativeBinding>();
  noteBrowserNativeBindingRecords = new Set<NoteBrowserNativeBinding>();
  // A NoteWeb open schedules several delayed DOM reconciliation passes. Keep
  // a token per leaf so an older open cannot overwrite a newer URL after the
  // new page has already painted.
  noteBrowserOpenTokens = new WeakMap<WorkspaceLeaf, number>();
  noteBrowserOpenSeq = 0;
  private apiListeners = new Set<MobileWebviewerApiListener>();
  readonly api: MobileWebviewerApi = {
    apiVersion: MOBILE_WEBVIEWER_API_VERSION,
    getCapabilities: () => this.mobileWebviewerCapabilities(),
    getStatus: () => this.mobileWebviewerStatus(),
    getCurrentContext: (options) => this.getCurrentWebContext(options),
    getSelection: () => this.getCurrentWebSelection(),
    readPage: (input) => this.readWebPageForApi(input),
    open: (input) => this.openFromApi(input),
    listTabs: () => this.listBrowserTabsForApi(),
    newTab: (input) => this.newBrowserTabFromApi(input),
    switchTab: (input) => this.switchBrowserTabFromApi(input),
    closeTab: (input) => this.closeBrowserTabFromApi(input),
    toggleBookmark: (input) => this.toggleBookmarkFromApi(input),
    addToReadingList: (input) => this.addToReadingListFromApi(input),
    sendToCancip: (input) => this.sendCurrentToCancip(input),
    subscribe: (listener) => this.subscribeApi(listener)
  };

  tr(key: UiTextKey, values: Record<string, string | number> = {}): string {
    return translateUiText(this.settings.uiLanguage || DEFAULT_UI_LANGUAGE, key, values);
  }

  resolvedUiLanguage(): string {
    return resolveUiLanguageCode(this.settings.uiLanguage || DEFAULT_UI_LANGUAGE);
  }

  async onload(): Promise<void> {
    await this.loadSettings();

    // Debug affordance: lets the maintenance tooling (and the release verifier)
    // exercise the reader-mode HTML -> Markdown converter in isolation.
    this.exposeMarkdownConverterDebugHook();

    this.registerView(VIEW_TYPE, (leaf) => new MobileWebviewerView(leaf, this));
    const hostWindow = appDocument().defaultView ?? window;
    for (const eventName of ["mousedown", "click", "dblclick"] as const) {
      this.registerDomEvent(hostWindow, eventName, (event) => {
        this.handleNoteBrowserDoubleActivation(event);
      }, { capture: true });
    }
    for (const eventName of ["pointerdown", "pointerup", "pointercancel", "pointerleave", "touchend", "click", "contextmenu"] as const) {
      this.registerDomEvent(hostWindow, eventName, (event) => {
        this.handleNoteDrawWebWandLifecycle(event);
      }, { capture: true });
    }
    this.registerMarkdownPostProcessor((el) => {
      this.processWebviewerEmbeds(el);
    });
    this.registerDomEvent(appDocument(), "click", (event) => {
      this.handleExternalLinkClick(event);
    }, { capture: true });
    this.registerDomEvent(appDocument(), "auxclick", (event) => {
      this.handleExternalLinkClick(event);
    }, { capture: true });
    this.registerDomEvent(appDocument(), "click", (event) => {
      void this.handleGlobalBingEvent(event);
    }, { capture: true });
    this.registerDomEvent(appDocument(), "auxclick", (event) => {
      void this.handleGlobalBingEvent(event);
    }, { capture: true });
    this.registerDomEvent(appDocument(), "click", (event) => {
      this.handleNoteDrawHeaderButtonActivation(event);
    }, { capture: true });
    this.registerDomEvent(appDocument(), "touchend", (event) => {
      this.handleNoteDrawHeaderButtonActivation(event);
    }, { capture: true });
    this.registerDomEvent(appDocument(), "keydown", (event) => {
      void this.handleGlobalBingEvent(event);
    }, { capture: true });
    this.registerDomEvent(appDocument(), "input", (event) => {
      this.handleNoteDrawWebNoteEditEvent(event);
    }, { capture: true });
    this.registerDomEvent(appDocument(), "keyup", (event) => {
      this.handleNoteDrawWebNoteEditEvent(event);
    }, { capture: true });
    this.registerDomEvent(appDocument(), "compositionend", (event) => {
      this.handleNoteDrawWebNoteEditEvent(event);
    }, { capture: true });
    this.registerDomEvent(appDocument(), "paste", (event) => {
      window.setTimeout(() => this.handleNoteDrawWebNoteEditEvent(event), 0);
    }, { capture: true });
    this.registerDomEvent(appDocument(), "click", (event) => {
      this.handleNoteDrawWebNoteEditEvent(event);
    }, { capture: true });
    this.installNoteDrawRawSurfaceGuard();
    this.installNoteDrawDedupeObserver();
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.installNoteDrawRawSurfaceGuard();
      this.disposeAllRawNoteDrawControllers();
      this.enforceNoteBrowserReadingMode();
      this.cleanupNoteBrowserDocumentResidue(this.app.workspace.containerEl);
      this.cleanupStaleNoteDrawButtonResidue(this.app.workspace.containerEl);
      this.app.workspace.containerEl
        .querySelectorAll<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR)
        .forEach((root) => {
          if (this.isNoteWebOwnedElement(root)) this.queueNoteDrawButtonDedupe(root);
        });
      this.app.workspace.containerEl
        .querySelectorAll<HTMLElement>(".mwv-note-browser-document")
      .forEach((documentEl) => this.queueLegacyNoteDrawWebviewerMigration(documentEl));
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      // A MarkdownView instance can be reused for another file. Clear the
      // NoteWeb-only marker/classes before delayed NoteWeb timers get a chance
      // to style an ordinary note or move its native NoteDraw toolbar.
      // Sweep every leaf because the previous NoteWeb leaf is not included in
      // the active-leaf event payload and can otherwise retain its z-index or
      // hidden-toolbar classes when the user opens a normal Markdown note.
      this.disposeAllRawNoteDrawControllers();
      this.app.workspace.containerEl
        .querySelectorAll<HTMLElement>("[data-mwv-noteweb-element-edit='true']")
        .forEach((embed) => {
          if (this.findWorkspaceLeafForElement(embed) !== leaf) void this.leaveNoteWebRawElementEditing(embed);
        });
      void this.disposeInactiveNoteWebControllers(leaf);
      this.cleanupNoteBrowserDocumentResidue(this.app.workspace.containerEl);
      this.cleanupStaleNoteDrawButtonResidue(this.app.workspace.containerEl);
      // Mobile opens Mobile Webviewer.md directly from the file explorer,
      // which fires active-leaf-change but not always layout-change. Force
      // reading mode here too so the embed never stays trapped at 0x0 inside
      // the Live Preview source DOM.
      this.enforceNoteBrowserReadingMode();
    }));

    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (!(file instanceof TFile) || file.path !== WEBVIEW_NOTE_PATH) return;
      this.enforceNoteBrowserReadingMode();
    }));

    this.addRibbonIcon("notebook-tabs", "Note browser", () => {
      void this.openNoteBrowser();
    });

    this.addCommand({
      id: "open-note-browser",
      name: "Open note browser",
      callback: () => void this.openNoteBrowser()
    });

    this.addCommand({
      id: "open-url",
      name: "Open URL in note browser",
      callback: async () => {
        const selected = this.app.workspace.activeEditor?.editor?.getSelection() ?? "";
        await this.openNoteBrowser(selected || this.settings.homeUrl);
      }
    });

    this.addCommand({
      id: "open-home",
      name: "Open note browser home",
      callback: () => void this.openNoteBrowser(this.settings.homeUrl)
    });

    this.registerObsidianProtocolHandler("mobile-webviewer", async (params) => {
      const url = typeof params.url === "string" ? params.url : this.settings.homeUrl;
      await this.openNoteBrowser(url);
    });

    this.registerObsidianProtocolHandler("mobile-webviewer-download", async (params) => {
      const url = typeof params.url === "string" ? params.url : "";
      if (!url) return;
      const entry = await this.downloadUrlFile(url);
      new Notice(`Download complete: ${entry.path || entry.message}`);
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        menu.addItem((item) => {
          item
            .setTitle("Open links in mobile webviewer")
            .setIcon("smartphone")
            .onClick(() => void this.openFirstLinkInFile(file));
        });
      })
    );

    this.addSettingTab(new MobileWebviewerSettingTab(this.app, this));

    // Keep the note browser enhanced after Markdown renders and Live Preview updates.
    this.app.workspace.onLayoutReady(() => {
      this.processWebviewerEmbeds(this.app.workspace.containerEl);
      this.cleanupStaleNoteDrawButtonResidue(this.app.workspace.containerEl);
      this.app.workspace.containerEl
        .querySelectorAll<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR)
        .forEach((root) => {
          if (this.isNoteWebOwnedElement(root)) this.queueNoteDrawButtonDedupe(root);
        });
      this.app.workspace.containerEl
        .querySelectorAll<HTMLElement>(".mwv-note-browser-document")
        .forEach((documentEl) => this.queueLegacyNoteDrawWebviewerMigration(documentEl));
      if (this.settings.openOnStartup) {
        void this.openNoteBrowser(this.settings.noteBrowserUrl || this.settings.homeUrl);
      }
    });
    this.app.workspace.containerEl
      .querySelectorAll<HTMLElement>(".mwv-note-browser-document")
      .forEach((documentEl) => this.queueLegacyNoteDrawWebviewerMigration(documentEl));
  }

  /**
   * Publishes the reader-mode Markdown converter on the host window so the
   * release tooling can diff converter output against fixtures without
   * opening a browser leaf. Purely a debug affordance; nothing in the plugin
   * reads it back.
   */
  exposeMarkdownConverterDebugHook(): void {
    const debugApi = {
      convert: htmlDocumentToMarkdown,
      isNoise: mdIsNoiseElement,
      blocksFrom: mdBlocksFromChildren,
      maxChars: MD_MAX_READER_CHARS,
      skipTags: MD_SKIP_TAGS,
      noisePattern: MD_NOISE_PATTERN,
      noiseRoles: MD_NOISE_ROLES
    };
    for (const target of this.markdownConverterDebugWindows()) {
      try {
        const host = target as Window & {
          __mwvConvertHtml?: typeof htmlDocumentToMarkdown;
          __mwvReaderDebug?: typeof debugApi;
        };
        host.__mwvConvertHtml = htmlDocumentToMarkdown;
        host.__mwvReaderDebug = debugApi;
      } catch (error) {
        // A locked-down window object is not worth failing plugin load over.
      }
    }
  }

  markdownConverterDebugWindows(): Window[] {
    const targets: Window[] = [window];
    const host = appDocument().defaultView;
    if (host && host !== window) targets.push(host);
    return targets;
  }

  onunload(): void {
    this.disposed = true;
    for (const target of this.markdownConverterDebugWindows()) {
      try {
        const host = target as Window & { __mwvConvertHtml?: unknown; __mwvReaderDebug?: unknown };
        delete host.__mwvConvertHtml;
        delete host.__mwvReaderDebug;
      } catch (error) {
        // Ignore.
      }
    }
    this.app.workspace.containerEl
      .querySelectorAll<HTMLElement>("[data-mwv-noteweb-element-edit='true']")
      .forEach((embed) => { void this.leaveNoteWebRawElementEditing(embed); });
    this.restoreNoteDrawRawSurfaceGuard();
    if (this.noteDrawLegacyMigrationTimer) window.clearTimeout(this.noteDrawLegacyMigrationTimer);
    for (const binding of [...this.noteBrowserNativeBindingRecords]) this.restoreNoteBrowserNativeBinding(binding);
    // Preserve user-arranged leaves when the plugin unloads.
  }

  handleNoteBrowserDoubleActivation(event: MouseEvent): void {
    if (event.detail < 2) return;
    const target = event.composedPath().find(isHtmlElement) ?? null;
    const noteBrowserRoot =
      target?.closest<HTMLElement>(".mwv-note-browser-document") ??
      target?.closest<HTMLElement>(".mwv-embed[data-url]") ??
      null;
    if (!noteBrowserRoot) return;

    const leaf = this.findWorkspaceLeafForElement(noteBrowserRoot);
    const file = (leaf?.view as { file?: unknown } | undefined)?.file;
    if (!leaf || !(file instanceof TFile) || file.path !== WEBVIEW_NOTE_PATH) return;

    // Keep Obsidian's reading-view double-click gesture outside NoteWeb. Do
    // not preventDefault(): native word selection inside NoteWeb should stay.
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.type !== "click") this.setNoteBrowserReadingMode(leaf);
  }

  installNoteDrawDedupeObserver(): void {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const mutationTarget = isHtmlElement(mutation.target) ? mutation.target : null;
        const mutationRoot = mutationTarget?.closest<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR) ??
          mutationTarget?.closest<HTMLElement>(".mwv-note-browser-document")?.querySelector<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR);
        if (mutationRoot && this.isNoteWebOwnedElement(mutationRoot) && this.isNoteBrowserWebMode(mutationRoot) && !this.isNoteBrowserRawEditingMode(mutationRoot)) {
          this.applyNoteBrowserWebIsolation(mutationRoot, true);
        }
        for (const node of Array.from(mutation.addedNodes)) {
          if (!isHtmlElement(node)) continue;
          if (!node.matches(NOTEDRAW_BUTTON_SELECTOR) && !node.querySelector(NOTEDRAW_BUTTON_SELECTOR)) continue;
          const root =
            node.closest<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR) ??
            (isHtmlElement(mutation.target) ? mutation.target.closest<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR) : null);
          if (!root) {
            continue;
          }
          if (!this.isNoteWebOwnedElement(root)) continue;
          this.queueNoteDrawButtonDedupe(root);
          this.queueLegacyNoteDrawWebviewerMigration(root);
          return;
        }
      }
    });
    observer.observe(this.app.workspace.containerEl, { childList: true, subtree: true });
    this.register(() => observer.disconnect());
  }

  queueNoteDrawButtonDedupe(root: HTMLElement): void {
    if (!root.isConnected || !this.isNoteWebOwnedElement(root)) return;
    const existing = this.noteDrawDedupeTimers.get(root);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      this.noteDrawDedupeTimers.delete(root);
      this.dedupeNoteDrawButtons(root);
    }, 80);
    this.noteDrawDedupeTimers.set(root, timer);
    for (const delay of [260, 900, 1800]) {
      window.setTimeout(() => {
        if (root.isConnected) this.dedupeNoteDrawButtons(root);
      }, delay);
    }
  }

  noteDrawButtonBelongsToSurface(button: HTMLElement, surface: HTMLElement): boolean {
    if (!this.isNoteWebOwnedElement(button) || !this.isNoteWebOwnedElement(surface)) return false;
    if (button.closest(".view-actions")) return false;
    if (button.closest(".mwv-notedraw-anchor")) return true;
    const controller = (button as NoteDrawButtonElement)._noteDrawController;
    const previewEl = controller?.previewEl;
    return Boolean(
      surface.contains(button) ||
      previewEl === surface ||
      (previewEl && surface.contains(previewEl)) ||
      (controller?.surfaceType === "webview" && this.isMobileWebviewerSurface(previewEl ?? surface))
    );
  }

  dedupeNoteDrawButtons(root: HTMLElement): void {
    if (!root.isConnected || !this.isNoteWebOwnedElement(root)) return;
    this.cleanupStaleNoteDrawButtonResidue(root.closest<HTMLElement>(".workspace-leaf-content") ?? root);
    const baseSurfaces = root.matches(MWV_DEDUPE_ROOT_SELECTOR)
      ? [root, ...Array.from(root.querySelectorAll<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR))]
      : Array.from(root.querySelectorAll<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR));
    for (const surface of new Set(baseSurfaces)) {
      if (!this.isMobileWebviewerSurface(surface)) continue;
      if (this.isNoteBrowserWebMode(surface)) {
        const leaf = surface.closest<HTMLElement>(".workspace-leaf-content");
        leaf?.addClass("mwv-notedraw-surface-leaf");
        const controller = this.findWebviewNoteDrawController(surface, true);
        if (this.isNoteBrowserRawEditingMode(surface) && controller) {
          this.ensureNoteWebElementSelectButton(controller, surface);
        }
        const retainedButton = controller ? this.retainNoteDrawWebviewButton(controller, surface) : null;
        if (retainedButton) {
          this.removeNoteWebWandProxy(surface);
        } else {
          this.ensureNoteWebWandProxy(surface);
        }
        this.hideNoteDrawHeaderButtonsForWebviewerLeaf(surface);
        continue;
      }
      this.prepareWebviewerDocumentLayout(surface);
      const hideSourceButton = (button: HTMLElement) => {
        button.addClass("mwv-notedraw-source-button");
        button.setAttribute("aria-hidden", "true");
        button.tabIndex = -1;
      };
      const leaf = surface.closest<HTMLElement>(".workspace-leaf-content");
      leaf?.addClass("mwv-notedraw-surface-leaf");
      const anchor = this.ensureNoteDrawStableAnchor(surface);
      const controller = this.findWebviewNoteDrawController(surface, true);
      const previewController = this.findNoteDrawPreviewController(surface, true);
      // NoteWeb reader surfaces are backed by NoteDraw's webview controller
      // in some NoteDraw versions. Keep the shared text-edit action on that
      // controller too; otherwise the visible toolbar only exposes drawing
      // selection and the NoteWeb element editor appears to do nothing.
      if (controller) this.ensureNoteWebElementSelectButton(controller, surface);
      if (previewController) this.ensureNoteWebElementSelectButton(previewController, surface);
      this.ensureNoteDrawControllerButtonAnchored(controller);
      const sourceButton = this.findNoteDrawWebviewSourceButton(surface);
      if (sourceButton) this.removeNoteWebWandProxy(surface);
      else this.ensureNoteWebWandProxy(surface, true);
      this.hideNoteDrawHeaderButtonsForWebviewerLeaf(surface);
      const buttons = Array.from(surface.querySelectorAll<HTMLElement>(NOTEDRAW_BUTTON_SELECTOR)).filter((button) =>
        !button.hasClass("mwv-notedraw-launcher") &&
        !button.hasClass("notedraw-header-button") &&
        this.noteDrawButtonBelongsToSurface(button, surface)
      );
      for (const button of buttons) {
        const controller = (button as NoteDrawButtonElement)._noteDrawController;
        if (controller?.surfaceType === "webview" && this.isMobileWebviewerSurface(controller.previewEl ?? surface)) {
          if (!this.isVisibleNoteDrawSurface(controller.previewEl ?? surface)) {
            button.removeClass("mwv-notedraw-top-button");
            hideSourceButton(button);
            continue;
          }
          if (button.parentElement !== anchor) anchor.appendChild(button);
          button.addClass("mwv-notedraw-top-button");
          button.removeClass("mwv-notedraw-source-button");
          button.removeAttribute("aria-hidden");
          button.tabIndex = 0;
        } else if (button.closest(".mwv-notedraw-anchor")) {
          button.addClass("mwv-notedraw-top-button");
          button.removeClass("mwv-notedraw-source-button");
          button.removeAttribute("aria-hidden");
          button.tabIndex = 0;
        } else {
          hideSourceButton(button);
        }
      }
      leaf?.querySelectorAll<HTMLElement>(".view-actions .notedraw-webview-button:not(.notedraw-header-button)").forEach((button) => {
        if (!button.closest(".mwv-notedraw-anchor")) hideSourceButton(button);
      });
    }
  }

  hideNoteDrawHeaderButtonsForWebviewerLeaf(surface: HTMLElement): void {
    const leaf = surface.closest<HTMLElement>(".workspace-leaf-content");
    if (!leaf) return;
    const hasWebviewerSurface = Array.from(leaf.querySelectorAll<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR))
      .some((candidate) => candidate.isConnected && this.isMobileWebviewerSurface(candidate));
    if (!hasWebviewerSurface) return;

    leaf.querySelectorAll<NoteDrawButtonElement>(".view-actions .notedraw-header-button").forEach((button) => {
      if (button.closest(".mwv-notedraw-anchor")) return;
      button.addClass("mwv-notedraw-webviewer-header-hidden");
      button.addClass("mwv-notedraw-source-button");
      button.setAttribute("aria-hidden", "true");
      button.tabIndex = -1;
    });
  }

  cleanupStaleNoteDrawButtonResidue(scope: HTMLElement = this.app.workspace.containerEl): void {
    this.restoreStaleNoteBrowserNativeBindings();
    const leaves = scope.matches(".workspace-leaf-content")
      ? [scope]
      : Array.from(scope.querySelectorAll<HTMLElement>(".workspace-leaf-content"));
    for (const leaf of leaves) {
      const workspaceLeaf = this.findWorkspaceLeafForElement(leaf);
      const noteWebLeaf = this.isNoteBrowserLeaf(workspaceLeaf);
      leaf.querySelectorAll<NoteWebElementToolbar>(".mwv-noteweb-element-toolbar").forEach((toolbar) => {
        const owner = toolbar._mwvNoteWebElementSurface;
        if (!noteWebLeaf || !owner?.isConnected || !this.isNoteBrowserRawEditingMode(owner)) toolbar.remove();
      });
      const hasMwvResidue = Boolean(
        leaf.hasClass("mwv-notedraw-surface-leaf") ||
        leaf.querySelector(".mwv-notedraw-anchor, [class*='mwv-notedraw-']")
      );
      const standaloneWebviewerRoot = leaf.querySelector<HTMLElement>(".mwv-root");
      const isStandaloneWebviewerLeaf = Boolean(standaloneWebviewerRoot);
      if (!noteWebLeaf) {
        // A MarkdownView can be reused for a different file before Obsidian
        // rebuilds its header DOM. Remove only the classes/elements owned by
        // NoteWeb so the ordinary note's native toolbar remains authoritative.
        leaf.querySelectorAll<HTMLElement>(
          ".mwv-note-browser-mode-action, .mwv-note-browser-native-nav, .mwv-note-browser-replaced-edit-action, .mwv-note-browser-native-title"
        ).forEach((element) => {
          element.removeClass("mwv-note-browser-mode-action");
          element.removeClass("mwv-note-browser-native-nav");
          element.removeClass("mwv-note-browser-replaced-edit-action");
          element.removeClass("mwv-note-browser-native-title");
          element.removeAttribute("aria-disabled");
          if (element instanceof HTMLButtonElement && element.disabled) element.disabled = false;
        });
        const staleWebviewControllers = new Set<NoteDrawControllerLike>();
        leaf.querySelectorAll<NoteDrawButtonElement>(".view-actions .notedraw-header-button, .notedraw-webview-button").forEach((button) => {
          const controller = button._noteDrawController;
          const hasMobileWebviewerMarker = [
            "mwv-notedraw-source-button",
            "mwv-notedraw-top-button",
            "mwv-notedraw-header-proxy",
            "mwv-notedraw-activation-proxy",
            "mwv-notedraw-webviewer-header-hidden"
          ].some((className) => button.hasClass(className));
          const isDisconnectedWebviewController = controller?.surfaceType === "webview" && !controller.previewEl?.isConnected;
          if (controller?.surfaceType === "webview" && (hasMobileWebviewerMarker || isDisconnectedWebviewController)) {
            staleWebviewControllers.add(controller);
          }
          if (hasMobileWebviewerMarker || isDisconnectedWebviewController) button.remove();
        });
        const noteDrawPlugin = this.getNoteDrawPlugin();
        noteDrawPlugin?.webviewControllers?.forEach((controller, surface) => {
          if (controller?.surfaceType !== "webview") return;
          const preview = controller.previewEl;
          if (!preview?.isConnected || this.findWorkspaceLeafForElement(preview) !== workspaceLeaf) return;
          const isNoteWebSurface = Boolean(
            preview.matches?.(".mwv-root, .mwv-embed[data-url], .mwv-note-embed[data-url], .mwv-bing-home[data-url]") ||
            surface.matches?.(".mwv-root, .mwv-embed[data-url], .mwv-note-embed[data-url], .mwv-bing-home[data-url]")
          );
          if (isNoteWebSurface) staleWebviewControllers.add(controller);
        });
        for (const controller of staleWebviewControllers) {
          try { controller.destroy?.(); } catch (error) { console.warn("[mobile-webviewer] stale NoteWeb controller cleanup skipped", error); }
        }
      }
      // Ordinary notes are never normal cleanup targets. The only exception
      // is removing marker classes/anchors that this plugin itself left there
      // before leaf ownership was enforced; native NoteDraw state is retained.
      if (!noteWebLeaf && !hasMwvResidue) continue;
      const hasMobileWebviewerSurface = Array.from(leaf.querySelectorAll<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR))
        .some((surface) => surface.isConnected && !surface.matches(".mwv-root") && this.isMobileWebviewerSurface(surface));
      const hasMobileWebviewerWebMode = Array.from(leaf.querySelectorAll<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR))
        .some((surface) => surface.isConnected && !surface.matches(".mwv-root") && this.isMobileWebviewerSurface(surface) && this.isNoteBrowserWebMode(surface));

      leaf.querySelectorAll<NoteDrawButtonElement>(".view-actions .notedraw-header-button").forEach((button) => {
        const hadHeaderProxy = button.hasClass("mwv-notedraw-header-proxy");
        const staleWebviewController = button._noteDrawController?.surfaceType === "webview" &&
          (hasMobileWebviewerWebMode || hadHeaderProxy || (!hasMobileWebviewerSurface && button.hasClass("mwv-notedraw-webviewer-header-hidden")));
        // The hidden marker belongs only to Web mode. When switching back to
        // Note mode, let this pass restore the native NoteDraw button instead
        // of leaving the old Web-mode toolbar state behind.
        if (hasMobileWebviewerWebMode && button.hasClass("mwv-notedraw-webviewer-header-hidden")) {
          return;
        }
        const hadMobileWebviewerState =
          button.hasClass("mwv-notedraw-source-button") ||
          button.hasClass("mwv-notedraw-top-button") ||
          hadHeaderProxy ||
          button.hasClass("mwv-notedraw-activation-proxy") ||
          button.hasClass("mwv-notedraw-webviewer-header-hidden");
        button.removeClass("mwv-notedraw-source-button");
        button.removeClass("mwv-notedraw-top-button");
        button.removeClass("mwv-notedraw-header-proxy");
        button.removeClass("mwv-notedraw-activation-proxy");
        button.removeClass("mwv-notedraw-webviewer-header-hidden");
        if (hadMobileWebviewerState) {
          button.removeAttribute("aria-hidden");
          if (button.getAttribute("tabindex") === "-1") button.removeAttribute("tabindex");
          if (noteWebLeaf && (hadHeaderProxy || staleWebviewController)) {
            button.removeClass("notedraw-webview-button");
            button.removeClass("is-active");
            button.removeAttribute("data-tooltip-position");
            if (button.getAttribute("aria-label") === "Edit web page drawing") button.removeAttribute("aria-label");
            if (button.getAttribute("title") === "Edit web page drawing") button.removeAttribute("title");
            if (staleWebviewController) delete button._noteDrawController;
          }
        }
      });

      if (isStandaloneWebviewerLeaf) {
        // The standalone Mobile Webviewer never owns a NoteDraw surface. Any
        // old toolbar/canvas left there by a previous plugin version is stale
        // and must not follow the user into the Markdown NoteWeb leaf.
        leaf.querySelectorAll<HTMLElement>(
          ".mwv-root .notedraw-toolbar, .mwv-root .notedraw-palette-panel, .mwv-root .notedraw-brush-panel, .mwv-root .notedraw-text-panel, .mwv-root .notedraw-selection-menu, .mwv-root .notedraw-format-toolbar, .mwv-root .notedraw-canvas, .mwv-root .notedraw-static-canvas, .mwv-root .notedraw-embed-layer"
        ).forEach((element) => element.remove());
        leaf.querySelectorAll<NoteDrawButtonElement>(NOTEDRAW_BUTTON_SELECTOR).forEach((button) => {
          const controller = button._noteDrawController;
          const pluginOwned = Boolean(
            controller?.surfaceType === "webview" ||
            button.hasClass("mwv-notedraw-source-button") ||
            button.hasClass("mwv-notedraw-top-button") ||
            button.hasClass("mwv-notedraw-header-proxy") ||
            button.hasClass("mwv-notedraw-activation-proxy") ||
            button.hasClass("mwv-notedraw-webviewer-header-hidden")
          );
          if (!pluginOwned) return;
          button.remove();
        });
        leaf.removeClass("mwv-notedraw-surface-leaf");
        leaf.querySelectorAll<HTMLElement>(".view-actions > .mwv-notedraw-anchor").forEach((anchor) => anchor.remove());
      }

      if (hasMobileWebviewerSurface) continue;
      leaf.removeClass("mwv-notedraw-surface-leaf");
      leaf.querySelectorAll<HTMLElement>(".view-actions > .mwv-notedraw-anchor").forEach((anchor) => anchor.remove());
    }
  }

  ensureNoteDrawStableAnchor(surface: HTMLElement): HTMLElement {
    const host = this.noteDrawStableAnchorHost(surface);
    const existing = host.querySelector<HTMLElement>(":scope > .mwv-notedraw-anchor");
    if (existing) return existing;
    const anchor = host.ownerDocument.createElement("div");
    anchor.className = "mwv-notedraw-anchor";
    anchor.setAttribute("aria-label", "Notedraw web page tools");
    host.insertBefore(anchor, host.firstChild);
    return anchor;
  }

  retainNoteDrawWebviewButton(controller: NoteDrawControllerLike, surface: HTMLElement): NoteDrawButtonElement | null {
    const previewEl = controller.previewEl ?? surface;
    const button = controller.button as NoteDrawButtonElement | undefined;
    if (!previewEl?.isConnected || !button?.isConnected) return null;
    if (!this.isNoteWebOwnedElement(previewEl) || !this.isNoteWebOwnedElement(button)) return null;
    if (!this.isMobileWebviewerSurface(previewEl) || !this.isNoteBrowserWebMode(previewEl)) return null;
    const anchor = this.ensureNoteDrawStableAnchor(previewEl);
    if (button.parentElement !== anchor) anchor.appendChild(button);
    button.addClass("mwv-notedraw-top-button");
    button.removeClass("mwv-notedraw-source-button");
    button.removeClass("mwv-notedraw-webviewer-header-hidden");
    button.removeAttribute("aria-hidden");
    button.tabIndex = 0;
    this.decorateNoteDrawWebWandButton(button);
    this.bindNoteDrawWebviewButton(button, controller);
    return button;
  }

  removeNoteWebWandProxy(surface: HTMLElement): void {
    const anchor = this.noteDrawStableAnchorHost(surface).querySelector<HTMLElement>(":scope > .mwv-notedraw-anchor");
    anchor?.querySelector<HTMLElement>("[data-mwv-noteweb-wand='true']")?.remove();
  }

  ensureNoteWebWandProxy(surface: HTMLElement, allowNoteMode = false): NoteDrawButtonElement | null {
    if (!surface.isConnected || !this.isNoteDrawSurfaceElement(surface) || (!allowNoteMode && !this.isNoteBrowserWebMode(surface))) return null;
    const anchor = this.ensureNoteDrawStableAnchor(surface);
    let button = anchor.querySelector<NoteDrawButtonElement>("[data-mwv-noteweb-wand='true']");
    if (!button) {
      button = anchor.createEl("button", {
        cls: "mwv-notedraw-web-wand mwv-notedraw-host-proxy clickable-icon",
        attr: {
          type: "button",
          "data-mwv-noteweb-wand": "true",
          "aria-label": "Web notedraw",
          title: "Web notedraw"
        }
      }) as NoteDrawButtonElement;
      button._mwvNoteWebWandProxy = true;
    }
    // The proxy is anchored in Obsidian's view-actions host, outside the
    // embed subtree. Retain the exact owner surface so click handling cannot
    // lose the NoteWeb page when the button is rendered in that host.
    button._mwvNoteWebWandSurface = surface;
    button.addClass("mwv-notedraw-top-button");
    button.removeAttribute("aria-hidden");
    button.tabIndex = 0;
    this.decorateNoteDrawWebWandButton(button);
    button.toggleClass("is-active", this.isNoteBrowserRawEditingMode(surface));
    button.setAttribute("aria-pressed", String(this.isNoteBrowserRawEditingMode(surface)));
    if (!button._mwvNoteWebWandBound) {
      button._mwvNoteWebWandBound = true;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        const current = button?._mwvNoteWebWandSurface;
        if (!current?.isConnected || !this.isNoteDrawSurfaceElement(current)) return;
        // The live website is a separate Electron guest document. Mounting a
        // full NoteDraw controller on its host changes the host layout but
        // still cannot reach guest-page text. Use the explicit cross-WebView
        // element editor instead and keep the original website presentation.
        if (this.isNoteBrowserWebMode(current)) {
          void this.toggleNoteWebRawElementEditing(current);
          return;
        }
        const controller = this.findWebviewNoteDrawController(current, true);
        if (controller && this.activateNoteDrawWebviewController(controller, current)) return;
        const activatePreviewController = () => {
          const preview = this.findNoteDrawPreviewController(current, true);
          if (!preview || !this.noteDrawControllerBelongsToRoot(preview, current)) return false;
          // A preview controller is the NoteDraw toolbar used to edit the
          // NoteWeb reading presentation. Do not toggle an already-active
          // controller off while recovering from a Web -> Note switch.
          if (this.isNoteDrawControllerActive(preview)) {
            this.ensureNoteDrawControllerButtonAnchored(preview);
            this.syncNoteDrawHeaderButtonState(current, preview);
            this.queueNoteDrawControllerSync(current, false);
            return true;
          }
          return this.activateNoteDrawControllerFromHeader(preview, current);
        };
        if (activatePreviewController()) return;
        this.queueNoteDrawControllerRestore(current);
        let activated = false;
        for (const delay of [120, 280, 600, 1000, 1800]) {
          window.setTimeout(() => {
            if (activated || !current.isConnected || this.isNoteBrowserWebMode(current)) return;
            const restored = this.findWebviewNoteDrawController(current, true);
            if (restored && this.activateNoteDrawWebviewController(restored, current)) {
              activated = true;
              return;
            }
            if (activatePreviewController()) {
              activated = true;
              return;
            }
            if (delay === 1800) {
              activated = true;
              this.triggerNoteDraw(current);
            }
          }, delay);
        }
      }, true);
    }
    return button;
  }

  async toggleNoteWebRawElementEditing(embed: HTMLElement): Promise<void> {
    if (!embed.isConnected || !this.isNoteWebOwnedElement(embed) || !this.isNoteBrowserWebMode(embed)) return;
    if (this.isNoteBrowserRawEditingMode(embed)) {
      await this.leaveNoteWebRawElementEditing(embed);
      return;
    }

    // Only one live guest owns the floating editor at a time. This keeps a
    // toolbar from a hidden NoteWeb tab from following the active page.
    const activeEditors = Array.from(this.app.workspace.containerEl.querySelectorAll<HTMLElement>(
      "[data-mwv-noteweb-element-edit='true']"
    )).filter((current) => current.matches(MWV_DEDUPE_ROOT_SELECTOR));
    for (const current of activeEditors) {
      if (current !== embed) await this.leaveNoteWebRawElementEditing(current);
    }

    const token = ++this.noteWebRawEditingSeq;
    embed.dataset.mwvNotewebElementEdit = "true";
    embed.dataset.mwvNotewebElementSelector = "true";
    delete embed.dataset.mwvNotewebDrawingVisible;
    // Raw editing is an explicit exception to Web-mode isolation: remove the
    // hidden marker before mounting NoteDraw so its primary toolbar and canvas
    // can be revealed by the stateful CSS below.
    this.applyNoteBrowserWebIsolation(embed, false);
    const fallbackToolbar = this.ensureNoteWebRawElementToolbar(embed);
    fallbackToolbar.dataset.mwvRawEditingToken = String(token);
    this.setNoteWebWandActive(embed, true);
    try { this.getNoteDrawPlugin()?.syncWebviewControllers?.(); } catch (error) { console.warn("[mobile-webviewer] raw NoteDraw sync skipped", error); }
    let controllerAttached = false;
    for (const delay of [0, 80, 220, 520, 1000]) {
      window.setTimeout(() => {
        if (controllerAttached || !embed.isConnected || embed.dataset.mwvNotewebElementEdit !== "true" || token !== this.noteWebRawEditingSeq) return;
        const controller = this.findWebviewNoteDrawController(embed, true);
        if (!controller) {
          try { this.getNoteDrawPlugin()?.syncWebviewControllers?.(); } catch (error) { /* noop */ }
          return;
        }
        controllerAttached = true;
        fallbackToolbar.remove();
        this.ensureNoteWebElementSelectButton(controller, embed);
        this.activateNoteDrawWebviewController(controller, embed);
        this.ensureNoteWebElementSelectButton(controller, embed);
      }, delay);
    }
    const enabled = await this.setNoteWebRawElementSelector(embed, true);
    if (!enabled && embed.isConnected && embed.dataset.mwvNotewebElementEdit === "true") {
      await this.leaveNoteWebRawElementEditing(embed);
    }
  }

  async leaveNoteWebRawElementEditing(embed: HTMLElement): Promise<void> {
    ++this.noteWebRawEditingSeq;
    const controller = this.findWebviewNoteDrawController(embed, true);
    delete embed.dataset.mwvNotewebElementEdit;
    delete embed.dataset.mwvNotewebElementSelector;
    await this.setNoteWebRawElementSelector(embed, false);
    // Match NoteDraw's normal toolbar toggle: deactivate the interaction
    // layer, but keep the controller, drawing data, static canvas, and embed
    // layers mounted so already-created doodles remain visible over the raw
    // page. Destruction is reserved for leaving/switching the Web surface.
    if (controller && this.isNoteDrawControllerActive(controller)) {
      try {
        await Promise.resolve(controller.toggle?.());
      } catch (error) {
        console.warn("[mobile-webviewer] raw NoteDraw close skipped", error);
      }
    }
    if (controller) {
      controller.active = false;
      controller.button?.removeClass("is-active");
      controller.syncFloatingControlClasses?.();
      controller.toolbar?.removeClass("is-drawing-active");
      controller.toolbar?.removeClass("is-notedraw-controls-visible");
      controller.palettePanel?.removeClass("is-drawing-active");
      controller.brushPanel?.removeClass("is-drawing-active");
      controller.textPanel?.removeClass("is-drawing-active");
      controller.selectionMenu?.removeClass("is-drawing-active");
      controller.formatToolbar?.removeClass("is-drawing-active");
      controller.render?.();
      controller.resizeCanvas?.();
      embed.dataset.mwvNotewebDrawingVisible = "true";
      await this.flushNoteDrawDrawingNow(controller);
    }
    embed.removeClass("mwv-noteweb-raw-selector-active");
    embed.removeClass("mwv-noteweb-raw-drawing-active");
    const leaf = embed.closest<HTMLElement>(".workspace-leaf-content");
    leaf?.querySelectorAll<NoteWebElementToolbar>(".mwv-noteweb-element-toolbar").forEach((toolbar) => {
      if (!toolbar._mwvNoteWebElementSurface || toolbar._mwvNoteWebElementSurface === embed) toolbar.remove();
    });
    this.setNoteWebWandActive(embed, false);
    if (embed.isConnected && this.isNoteBrowserWebMode(embed)) {
      this.applyNoteBrowserWebIsolation(embed, true);
      // The controller is intentionally retained for static artwork. Reuse
      // its real NoteDraw button when available; otherwise fall back to the
      // host proxy. This keeps exactly one wand visible after closing.
      const retainedButton = controller ? this.retainNoteDrawWebviewButton(controller, embed) : null;
      if (retainedButton) this.removeNoteWebWandProxy(embed);
      else this.ensureNoteWebWandProxy(embed);
    }
  }

  ensureNoteWebElementSelectButton(controller: NoteDrawControllerLike, surface: HTMLElement): HTMLButtonElement | null {
    const toolbar = controller.toolbar;
    if (!toolbar?.isConnected || !this.isNoteWebOwnedElement(surface)) return null;
    const existing = controller._mwvNoteWebElementSelectButton;
    if (existing?.isConnected && controller._mwvNoteWebElementSurface === surface) {
      this.syncNoteWebElementSelectButton(controller, surface);
      return existing;
    }
    existing?.remove();
    const button = toolbar.createEl("button", {
      cls: "mwv-noteweb-element-select",
      attr: {
        type: "button",
        title: "选择网页元素编辑文字",
        "aria-label": "选择网页元素编辑文字"
      }
    });
    setIcon(button, "mouse-pointer-2");
    controller._mwvNoteWebElementSelectButton = button;
    controller._mwvNoteWebElementSurface = surface;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      if (controller.surfaceType === "webview") {
        if (this.isNoteBrowserRawEditingMode(surface)) {
          const enable = surface.dataset.mwvNotewebElementSelector !== "true";
          void this.setNoteWebRawElementSelector(surface, enable);
          return;
        }
        // NoteWeb's Markdown presentation is backed by NoteDraw's webview
        // controller on some plugin versions. Treat it exactly like the
        // preview controller so the shared button enters native Markdown
        // text editing instead of becoming a no-op.
        if (!this.isNoteDrawControllerActive(controller)) {
          this.activateNoteDrawWebviewController(controller, surface);
        }
        const editing = controller.toolMode === "edit-md";
        this.setNoteDrawWebviewTool(controller, editing ? "select" : "edit-md");
        button.toggleClass("is-active", !editing);
        button.setAttribute("aria-pressed", String(!editing));
        this.queueNoteDrawControllerSync(surface, false);
      } else if (controller.surfaceType === "preview") {
        const editing = controller.toolMode === "edit-md";
        this.setNoteDrawWebviewTool(controller, editing ? "select" : "edit-md");
        button.toggleClass("is-active", !editing);
        button.setAttribute("aria-pressed", String(!editing));
      }
    }, true);
    this.syncNoteWebElementSelectButton(controller, surface);
    return button;
  }

  syncNoteWebElementSelectButton(controller: NoteDrawControllerLike, surface: HTMLElement): void {
    const button = controller._mwvNoteWebElementSelectButton;
    if (!button?.isConnected) return;
    const active = controller.surfaceType === "webview" && this.isNoteBrowserRawEditingMode(surface)
      ? surface.dataset.mwvNotewebElementSelector === "true"
      : controller.toolMode === "edit-md";
    button.toggleClass("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  ensureNoteWebRawElementToolbar(embed: HTMLElement): NoteWebElementToolbar {
    const host = embed.closest<HTMLElement>(".workspace-leaf-content") ?? embed;
    host.querySelectorAll<NoteWebElementToolbar>(".mwv-noteweb-element-toolbar").forEach((toolbar) => toolbar.remove());
    const toolbar = host.createDiv({
      cls: "notedraw-toolbar notedraw-body-control is-drawing-active is-notedraw-controls-visible mwv-noteweb-element-toolbar",
      attr: {
        role: "toolbar",
        "aria-label": "网页文字编辑工具"
      }
    }) as NoteWebElementToolbar;
    toolbar._mwvNoteWebElementSurface = embed;

    const select = toolbar.createEl("button", {
      cls: "mwv-noteweb-element-select is-active",
      attr: {
        type: "button",
        title: "选择网页元素编辑文字",
        "aria-label": "选择网页元素编辑文字",
        "aria-pressed": "true"
      }
    });
    setIcon(select, "mouse-pointer-2");
    select.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const current = toolbar._mwvNoteWebElementSurface;
      if (!current?.isConnected || !this.isNoteBrowserRawEditingMode(current)) return;
      const enable = current.dataset.mwvNotewebElementSelector !== "true";
      void this.setNoteWebRawElementSelector(current, enable);
    });

    const hint = toolbar.createSpan({ cls: "mwv-noteweb-element-hint", text: "选择文字后直接编辑" });
    hint.setAttribute("aria-hidden", "true");

    const close = toolbar.createEl("button", {
      cls: "mwv-noteweb-element-close",
      attr: {
        type: "button",
        title: "退出网页文字编辑",
        "aria-label": "退出网页文字编辑"
      }
    });
    setIcon(close, "x");
    close.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const current = toolbar._mwvNoteWebElementSurface;
      if (current) void this.leaveNoteWebRawElementEditing(current);
    });
    return toolbar;
  }

  setNoteWebWandActive(embed: HTMLElement, active: boolean): void {
    const anchor = this.noteDrawStableAnchorHost(embed).querySelector<HTMLElement>(":scope > .mwv-notedraw-anchor");
    anchor?.querySelectorAll<HTMLElement>(".mwv-notedraw-web-wand").forEach((wand) => {
      wand.toggleClass("is-active", active);
      wand.setAttribute("aria-pressed", String(active));
    });
  }

  bindNoteDrawRawToolButtons(controller: NoteDrawControllerLike, surface: HTMLElement): void {
    if (!this.isNoteBrowserRawEditingMode(surface)) return;
    const record = controller as NoteDrawControllerLike & Record<string, unknown>;
    const tools: Array<[string, "draw" | "text"]> = [
      ["penButton", "draw"],
      ["watercolorButton", "draw"],
      ["textButton", "text"]
    ];
    for (const [key] of tools) {
      const button = record[key];
      if (!(button instanceof HTMLElement) || !button.isConnected) continue;
      const marked = button as HTMLElement & Record<string, unknown>;
      if (marked._mwvNoteWebRawToolBound === true) continue;
      marked._mwvNoteWebRawToolBound = true;
      button.addEventListener("click", () => {
        if (!surface.isConnected || !this.isNoteBrowserRawEditingMode(surface)) return;
        // The guest selector and the drawing canvas cannot own the pointer at
        // the same time. A brush/text click always returns ownership to the
        // NoteDraw overlay, while the live page remains otherwise untouched.
        if (surface.dataset.mwvNotewebElementSelector === "true") {
          void this.setNoteWebRawElementSelector(surface, false);
        }
        this.syncNoteWebRawDrawingState(surface, controller);
      }, true);
    }
  }

  syncNoteWebRawDrawingState(surface: HTMLElement, controller?: NoteDrawControllerLike | null): void {
    if (!surface.isConnected || !this.isNoteBrowserRawEditingMode(surface)) return;
    const activeController = controller ?? this.findWebviewNoteDrawController(surface, true);
    if (activeController) this.bindNoteDrawRawToolButtons(activeController, surface);
    const selectorActive = surface.dataset.mwvNotewebElementSelector === "true";
    surface.toggleClass("mwv-noteweb-raw-selector-active", selectorActive);
    surface.toggleClass("mwv-noteweb-raw-drawing-active", !selectorActive);
  }

  rawElementEditsForUrl(url: string): BrowserWebTextEdit[] {
    const note = this.settings.webNotes.find((entry) => equivalentEmbedUrl(entry.url, url));
    return normalizeBrowserWebTextEdits(note?.pageEdits);
  }

  async setNoteWebRawElementSelector(embed: HTMLElement, enabled: boolean): Promise<boolean> {
    // The first paint uses the small fallback toolbar; once NoteDraw mounts,
    // the same button is moved into its real toolbar. Update every button on
    // this surface so the visual state cannot become stale after a toggle.
    const leaf = embed.closest<HTMLElement>(".workspace-leaf-content");
    const selectButtons = Array.from(embed.querySelectorAll<HTMLButtonElement>(".mwv-noteweb-element-select"));
    if (!selectButtons.length) {
      selectButtons.push(...Array.from(
        leaf?.querySelectorAll<HTMLButtonElement>(".mwv-noteweb-element-toolbar .mwv-noteweb-element-select") ?? []
      ));
    }
    selectButtons.forEach((button) => {
      button.toggleClass("is-active", enabled);
      button.setAttribute("aria-pressed", String(enabled));
    });
    if (enabled) embed.dataset.mwvNotewebElementSelector = "true";
    else delete embed.dataset.mwvNotewebElementSelector;
    this.syncNoteWebRawDrawingState(embed);

    const frame = embed.querySelector<BrowserSurfaceElement>(":scope > .mwv-live-browser > .mwv-live-frame");
    if (!this.isElectronWebview(frame)) {
      if (enabled) new Notice("当前网页内核不支持元素编辑");
      return !enabled;
    }
    frame._mwvRawElementEditorEnabled = enabled;
    if (!this.isBrowserSurfaceReady(frame) || typeof frame.executeJavaScript !== "function") {
      return !enabled || Boolean(frame.isConnected && frame._mwvDestroyed !== true);
    }

    const url = this.safeWebviewUrl(frame) || embed.dataset.url || this.settings.homeUrl;
    const edits = enabled ? this.rawElementEditsForUrl(url) : [];
    const code = this.noteWebRawElementEditorScript(enabled, edits);
    try {
      await frame.executeJavaScript(code, true);
      return true;
    } catch (error) {
      console.warn("[mobile-webviewer] raw page element editor skipped", error);
      if (enabled) new Notice("网页元素编辑器启动失败");
      return !enabled;
    }
  }

  noteWebRawElementEditorScript(enabled: boolean, edits: BrowserWebTextEdit[]): string {
    const payload = JSON.stringify({ enabled, edits: normalizeBrowserWebTextEdits(edits) });
    return `
      (() => {
        const options = ${payload};
        const key = "__mwvNoteWebElementEditor";
        const existing = window[key];
        if (!options.enabled) {
          existing?.destroy?.();
          try { delete window[key]; } catch (error) { window[key] = undefined; }
          return true;
        }
        existing?.destroy?.();

        const doc = document;
        if (!doc.body || !doc.documentElement) return false;
        const editableSelector = "h1,h2,h3,h4,h5,h6,p,li,blockquote,td,th,label,summary,figcaption,caption,pre,a,span,div";
        const blockedSelector = "button,input,textarea,select,img,svg,canvas,video,audio,webview,iframe,[role='button'],[contenteditable='true']";
        const marker = "data-mwv-noteweb-selected";
        const style = doc.createElement("style");
        style.id = "mwv-noteweb-element-editor-style";
        style.textContent = \`
          html.mwv-noteweb-element-selecting, html.mwv-noteweb-element-selecting * { cursor: crosshair !important; }
          html.mwv-noteweb-element-selecting [\${marker}="true"] {
            cursor: text !important;
            outline: 2px solid #3b82f6 !important;
            outline-offset: 2px !important;
          }
        \`;
        doc.getElementById(style.id)?.remove();
        doc.documentElement.appendChild(style);

        const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
        const elementPath = (element) => {
          const parts = [];
          let current = element;
          while (current && current !== doc.body && current.nodeType === 1) {
            const tag = String(current.localName || "").toLowerCase();
            if (!tag || !current.parentElement) return "";
            const siblings = Array.from(current.parentElement.children).filter((item) => item.localName === current.localName);
            parts.unshift(tag + ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")");
            current = current.parentElement;
          }
          return current === doc.body && parts.length ? "body > " + parts.join(" > ") : "";
        };
        const findSavedTarget = (edit) => {
          let target = null;
          try { target = edit.path ? doc.querySelector(edit.path) : null; } catch (error) {}
          const original = normalize(edit.originalText);
          const edited = normalize(edit.editedText);
          const current = normalize(target?.innerText);
          if (target && (current === original || current === edited)) return target;
          return Array.from(doc.body.querySelectorAll(editableSelector)).find((candidate) => {
            const text = normalize(candidate.innerText);
            return text && (text === original || text === edited);
          }) || null;
        };
        for (const edit of Array.isArray(options.edits) ? options.edits : []) {
          if (!edit || edit.kind !== "text" || !edit.path || typeof edit.editedText !== "string") continue;
          const target = findSavedTarget(edit);
          if (target && normalize(target.innerText) !== normalize(edit.editedText)) target.innerText = edit.editedText;
        }

        let current = null;
        let originalText = "";
        let previousEditable = null;
        let hadEditable = false;
        const sendEdit = (element, before, after) => {
          const path = elementPath(element);
          if (!path || normalize(before) === normalize(after)) return;
          try {
            console.info("__MWV_BRIDGE__" + JSON.stringify({
              kind: "webnote",
              url: location.href,
              title: document.title || location.hostname,
              pageEdited: true,
              webEdit: {
                kind: "text",
                path,
                originalText: String(before || ""),
                editedText: String(after || ""),
                updatedAt: new Date().toISOString()
              }
            }));
          } catch (error) {}
        };
        const finish = () => {
          if (!current) return;
          const target = current;
          const before = originalText;
          current = null;
          target.removeAttribute(marker);
          if (hadEditable) target.setAttribute("contenteditable", previousEditable || "");
          else target.removeAttribute("contenteditable");
          target.removeAttribute("spellcheck");
          sendEdit(target, before, target.innerText || target.textContent || "");
        };
        const pickTarget = (event) => {
          const source = event.composedPath?.()[0] || event.target;
          if (!(source instanceof Element) || source.closest(blockedSelector)) return null;
          let target = source.closest(editableSelector);
          while (target && target !== doc.body) {
            if (!target.closest(blockedSelector) && normalize(target.innerText)) return target;
            target = target.parentElement?.closest?.(editableSelector) || null;
          }
          return null;
        };
        const onClick = (event) => {
          const target = pickTarget(event);
          if (!target) return;
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          finish();
          current = target;
          originalText = target.innerText || target.textContent || "";
          hadEditable = target.hasAttribute("contenteditable");
          previousEditable = target.getAttribute("contenteditable");
          target.setAttribute(marker, "true");
          target.setAttribute("contenteditable", "true");
          target.setAttribute("spellcheck", "true");
          target.focus({ preventScroll: true });
          try {
            const selection = window.getSelection();
            const range = doc.createRange();
            range.selectNodeContents(target);
            selection.removeAllRanges();
            selection.addRange(range);
          } catch (error) {}
        };
        const onKeyDown = (event) => {
          if (!current) return;
          if (event.key === "Escape" || ((event.ctrlKey || event.metaKey) && event.key === "Enter")) {
            event.preventDefault();
            finish();
          }
        };
        const onBlur = (event) => {
          if (!current || event.target !== current) return;
          setTimeout(() => {
            if (current && doc.activeElement !== current) finish();
          }, 80);
        };
        const onPageHide = () => finish();
        doc.addEventListener("click", onClick, true);
        doc.addEventListener("keydown", onKeyDown, true);
        doc.addEventListener("blur", onBlur, true);
        window.addEventListener("pagehide", onPageHide, true);
        doc.documentElement.classList.add("mwv-noteweb-element-selecting");
        window[key] = {
          destroy() {
            finish();
            doc.removeEventListener("click", onClick, true);
            doc.removeEventListener("keydown", onKeyDown, true);
            doc.removeEventListener("blur", onBlur, true);
            window.removeEventListener("pagehide", onPageHide, true);
            doc.documentElement.classList.remove("mwv-noteweb-element-selecting");
            style.remove();
          }
        };
        return true;
      })();
    `;
  }

  noteDrawStableAnchorHost(surface: HTMLElement): HTMLElement {
    return (
      surface.closest<HTMLElement>(".workspace-leaf-content")?.querySelector<HTMLElement>(".view-actions") ??
      surface.closest<HTMLElement>(".view-content") ??
      surface
    );
  }

  handleNoteDrawHeaderButtonActivation(event: Event): void {
    const target = isHtmlElement(event.target) ? event.target : null;
    const button = target?.closest<NoteDrawButtonElement>(".notedraw-header-button");
    if (!button?.isConnected) return;
    const ownerLeaf = this.findWorkspaceLeafForElement(button);
    if (!this.isNoteBrowserLeaf(ownerLeaf)) return;

    const surface = this.findNoteDrawHeaderSurface(button);
    if (!surface) {
      this.activateNoteDrawFromNoteBrowserSource(button, event);
      return;
    }
    if (event.type === "touchend" && !this.shouldHandleNoteDrawHeaderTouchEnd()) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    this.activateNoteDrawViaHiddenSourceButton(surface, event);
  }

  findNoteDrawHeaderSurface(button: HTMLElement): HTMLElement | null {
    const leaf = button.closest<HTMLElement>(".workspace-leaf-content");
    if (!leaf) return null;
    if (!this.isNoteBrowserLeaf(this.findWorkspaceLeafForElement(leaf))) return null;

    const surfaces = Array.from(leaf.querySelectorAll<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR))
      .filter((surface) => surface.isConnected && this.isMobileWebviewerSurface(surface));
    if (!surfaces.length) return null;
    leaf.addClass("mwv-notedraw-surface-leaf");

    const activeElement = appDocument().activeElement;
    if (isHtmlElement(activeElement)) {
      const activeSurface = activeElement.closest<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR);
      if (activeSurface && surfaces.includes(activeSurface)) return activeSurface;
    }

    return (
      surfaces.find((surface) => Boolean(this.findWebviewNoteDrawController(surface, true))) ??
      surfaces.find((surface) => {
        const rect = surface.getBoundingClientRect();
        const style = window.getComputedStyle(surface);
        return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden";
      }) ??
      surfaces[0] ??
      null
    );
  }

  activateNoteDrawFromNoteBrowserSource(button: HTMLElement, event: Event): void {
    const leafContent = button.closest<HTMLElement>(".workspace-leaf-content");
    if (!leafContent) return;
    const leaf = this.findWorkspaceLeafForElement(leafContent);
    const file = (leaf?.view as { file?: unknown } | undefined)?.file;
    if (!(file instanceof TFile) || file.path !== WEBVIEW_NOTE_PATH || !leaf) return;
    if (event.type === "touchend" && !this.shouldHandleNoteDrawHeaderTouchEnd()) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    this.setNoteBrowserReadingMode(leaf);

    let activated = false;
    for (const delay of [80, 180, 360, 720, 1200, 1800]) {
      window.setTimeout(() => {
        if (activated) return;
        const container = leaf.view?.containerEl;
        if (!container?.isConnected) return;
        this.processWebviewerEmbeds(container);
        const surface = Array.from(container.querySelectorAll<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR))
          .find((candidate) => candidate.isConnected && this.isMobileWebviewerSurface(candidate));
        if (!surface) return;
        activated = true;
        this.refreshNoteDrawWorkspaceBinding(surface, true, true);
        this.activateNoteDrawViaHiddenSourceButton(surface);
      }, delay);
    }
  }

  shouldHandleNoteDrawHeaderTouchEnd(): boolean {
    return Platform.isIosApp;
  }

  requestNoteDrawHeaderActivation(surface: HTMLElement): void {
    const token = ++this.noteDrawHeaderActivationSeq;
    this.noteDrawHeaderActivationTokens.set(surface, token);
    this.tryActivateNoteDrawHeader(surface, token, 0);
  }

  activateNoteDrawViaHiddenSourceButton(surface: HTMLElement, event?: Event): void {
    const token = ++this.noteDrawHeaderActivationSeq;
    this.noteDrawHeaderActivationTokens.set(surface, token);
    this.tryActivateNoteDrawSourceButton(surface, token, 0, event);
  }

  tryActivateNoteDrawSourceButton(surface: HTMLElement, token: number, attempt: number, event?: Event): void {
    if (!surface.isConnected || this.noteDrawHeaderActivationTokens.get(surface) !== token) return;
    this.refreshNoteDrawWorkspaceBinding(surface, true, attempt === 0 || attempt === 2);
    const sourceButton = this.findNoteDrawWebviewSourceButton(surface);
    const controller = sourceButton?._noteDrawController ?? this.findWebviewNoteDrawController(surface, true);
    if (controller && this.activateNoteDrawControllerFromHeader(controller, surface, event)) {
      this.noteDrawHeaderActivationTokens.delete(surface);
      return;
    }
    if (sourceButton) {
      this.noteDrawHeaderActivationTokens.delete(surface);
      this.dispatchHiddenActivationClick(sourceButton);
      this.queueNoteDrawButtonDedupe(surface);
      this.queueNoteDrawControllerSync(surface, true);
      return;
    }

    const delays = [0, 80, 180, 360, 720, 1200];
    if (attempt < delays.length - 1) {
      window.setTimeout(() => this.tryActivateNoteDrawSourceButton(surface, token, attempt + 1, event), delays[attempt + 1]);
      return;
    }

    this.noteDrawHeaderActivationTokens.delete(surface);
    this.requestNoteDrawHeaderActivation(surface);
  }

  activateNoteDrawControllerFromHeader(controller: NoteDrawControllerLike, surface: HTMLElement, event?: Event): boolean {
    if (!this.noteDrawControllerBelongsToRoot(controller, surface)) return false;
    if (controller.surfaceType === "preview") this.ensureNoteWebElementSelectButton(controller, surface);
    if (controller.surfaceType === "webview" && this.isMobileWebviewerSurface(controller.previewEl ?? surface)) {
      return this.activateNoteDrawWebviewController(controller, surface);
    }

    const wasActive = this.isNoteDrawControllerActive(controller);
    if (wasActive) {
      return this.deactivateNoteDrawControllerFromHeader(controller, surface);
    }
    const afterActivation = () => {
      const active = this.isNoteDrawControllerActive(controller);
      this.syncNoteDrawHeaderButtonState(surface, controller);
      this.queueNoteDrawButtonDedupe(surface);
      this.queueNoteDrawControllerSync(surface, !wasActive || active);
      if (active) {
        if (controller.surfaceType === "preview") this.ensureNoteWebElementSelectButton(controller, surface);
        controller.scheduleLayoutRefresh?.();
        controller.updateFloatingControlsPosition?.();
      }
    };
    const run = (label: string, callback?: () => void | Promise<void>): boolean => {
      if (typeof callback !== "function") return false;
      try {
        void Promise.resolve(callback())
          .catch((error) => {
            console.error(`[mobile-webviewer] NoteDraw header ${label} failed`, error);
          })
          .then(afterActivation);
        afterActivation();
        window.setTimeout(afterActivation, 80);
        window.setTimeout(afterActivation, 260);
        return true;
      } catch (error) {
        console.error(`[mobile-webviewer] NoteDraw header ${label} failed`, error);
        return false;
      }
    };

    if (event?.type === "touchend" && run("touchend", () => controller.onButtonTouchEnd?.(event))) return true;
    const clickEvent = event instanceof MouseEvent ? event : new MouseEvent("click", { bubbles: true, cancelable: true });
    if (run("click", () => controller.onButtonClick?.(clickEvent))) return true;
    return run("toggle", () => controller.toggle?.());
  }

  activateNoteDrawWebviewController(controller: NoteDrawControllerLike, surface: HTMLElement): boolean {
    const previewEl = controller.previewEl ?? surface;
    if (!previewEl?.isConnected || !this.isMobileWebviewerSurface(previewEl) || !this.noteDrawControllerBelongsToRoot(controller, surface)) return false;

    const alreadyActive = this.isNoteDrawControllerActive(controller);
    if (alreadyActive && this.isNoteDrawWebviewToolbarVisible(controller)) {
      if (controller.toolMode === "edit-md") {
        this.setNoteDrawWebviewTool(controller, "select");
        this.forceNoteDrawWebviewToolbarVisible(controller, previewEl);
        return true;
      }
      return this.deactivateNoteDrawControllerFromHeader(controller, previewEl);
    }

    this.refreshNoteDrawWorkspaceBinding(previewEl, true, true);
    this.ensureNoteWebElementSelectButton(controller, surface);
    const runAfterOpen = () => this.forceNoteDrawWebviewToolbarVisible(controller, previewEl);
    const openDirectly = () => {
      controller.active = true;
      this.setNoteDrawWebviewTool(controller, "select");
      previewEl.addClass("notedraw-shell");
      previewEl.addClass("is-notedraw-webview-shell");
      previewEl.addClass("is-drawing-active");
      controller.button?.addClass("is-active");
      controller.toolbar?.addClass("is-drawing-active");
      controller.toolbar?.addClass("is-notedraw-controls-visible");
      controller.syncFloatingControlClasses?.();
      controller.toolbar?.addClass("is-drawing-active");
      controller.toolbar?.addClass("is-notedraw-controls-visible");
    };

    const afterOpen = () => {
      runAfterOpen();
      this.ensureNoteWebElementSelectButton(controller, surface);
      for (const delay of [80, 220, 520, 900]) {
        window.setTimeout(runAfterOpen, delay);
      }
    };

    if (alreadyActive || typeof controller.toggle !== "function") {
      openDirectly();
      afterOpen();
      return true;
    }

    try {
      void Promise.resolve(controller.toggle())
        .catch((error) => {
          console.error("[mobile-webviewer] NoteDraw webview direct toggle failed", error);
          openDirectly();
        })
        .then(afterOpen);
      afterOpen();
      return true;
    } catch (error) {
      console.error("[mobile-webviewer] NoteDraw webview direct toggle failed", error);
      openDirectly();
      afterOpen();
      return true;
    }
  }

  forceNoteDrawWebviewToolbarVisible(controller: NoteDrawControllerLike, surface: HTMLElement): void {
    const previewEl = controller.previewEl ?? surface;
    if (!previewEl?.isConnected || !this.isMobileWebviewerSurface(previewEl) || !this.noteDrawControllerBelongsToRoot(controller, surface)) return;
    // Delayed NoteDraw reconciliation is allowed to finish an explicit raw
    // Web open, but it must never resurrect the toolbar after the user has
    // clicked the same wand to leave that mode.
    if (this.isNoteBrowserWebMode(previewEl) && !this.isNoteBrowserRawEditingMode(previewEl)) return;

    controller.active = true;
    controller.allowTextEdit = true;
    // Opening the toolbar starts in drawing-selection mode, but delayed
    // NoteDraw layout refreshes must preserve a brush/text mode chosen by the
    // user. Resetting the tool here on every refresh made drawing impossible.
    if (!controller.toolMode) this.setNoteDrawWebviewTool(controller, "select");
    previewEl.addClass("notedraw-shell");
    previewEl.addClass("is-notedraw-webview-shell");
    previewEl.addClass("is-drawing-active");
    controller.button?.addClass("is-active");
    controller.syncFloatingControlClasses?.();
    // Only the primary toolbar is made visible here. NoteDraw owns the
    // secondary-panel state classes; forcing them open makes every palette,
    // brush, text, and selection panel appear at once on a raw page.
    controller.toolbar?.addClass("is-drawing-active");
    controller.toolbar?.addClass("is-notedraw-controls-visible");

    this.ensureNoteDrawControllerButtonAnchored(controller);
    this.bindNoteDrawRawToolButtons(controller, previewEl);
    this.syncNoteWebRawDrawingState(previewEl, controller);
    this.syncNoteDrawHeaderButtonState(previewEl, controller);
    this.queueNoteDrawButtonDedupe(previewEl);
    this.queueNoteDrawControllerSync(previewEl, false);

    try {
      void controller.ensureDrawingsLoaded?.().catch((error) => {
        console.warn("[mobile-webviewer] NoteDraw webview drawing load skipped", error);
      });
      controller.plugin?.setInteractionController?.(controller);
      controller.syncFloatingControlClasses?.();
      controller.scheduleLayoutRefresh?.();
      controller.updateFloatingControlsPosition?.();
      controller.resizeCanvas?.();
      controller.render?.();
    } catch (error) {
      console.warn("[mobile-webviewer] NoteDraw webview toolbar refresh skipped", error);
    }
  }

  setNoteDrawWebviewTool(controller: NoteDrawControllerLike, tool: "select" | "draw" | "text" | "edit-md"): void {
    try {
      if (typeof controller.setToolFromApi === "function" && controller.setToolFromApi(tool)) return;
      if (tool === "select" && typeof controller.toggleSelectMode === "function" && controller.toolMode !== "select") {
        controller.toggleSelectMode();
      }
    } catch (error) {
      console.warn("[mobile-webviewer] NoteDraw webview tool switch skipped", error);
    }
  }

  restoreNoteBrowserNativeBinding(binding: NoteBrowserNativeBinding): void {
    const { leaf, view } = binding;
    binding.modeAction?.remove();
    binding.hiddenEditButtons.forEach((button) => {
      if (!button.isConnected) return;
      button.removeClass("mwv-note-browser-replaced-edit-action");
    });
    binding.navButtons.forEach((entry) => {
      entry.element.removeEventListener("click", entry.handler, true);
      entry.element.removeClass("mwv-note-browser-native-nav");
      entry.element.removeClass("is-disabled");
      entry.element.removeAttribute("aria-disabled");
      if (entry.element instanceof HTMLButtonElement) entry.element.disabled = entry.originalDisabled;
    });
    binding.navButtons = [];
    if (view.onPaneMenu === binding.guardedPaneMenu) {
      if (binding.originalPaneMenu) view.onPaneMenu = binding.originalPaneMenu;
      else delete view.onPaneMenu;
    }
    if (binding.originalSetState && view.setState === binding.guardedSetState) view.setState = binding.originalSetState;
    const container = leaf.view?.containerEl;
    const file = (leaf.view as { file?: unknown } | undefined)?.file;
    const fallbackTitle = file instanceof TFile ? file.basename : leaf.view?.getDisplayText?.();
    const leafEl = container?.closest<HTMLElement>(".workspace-leaf") ?? container;
    const tabTitle = (leaf as WorkspaceLeaf & { tabHeaderInnerTitleEl?: HTMLElement }).tabHeaderInnerTitleEl;
    const titles = [
      ...(leafEl ? Array.from(leafEl.querySelectorAll<HTMLElement>(".view-header-title")) : []),
      ...(tabTitle ? [tabTitle] : [])
    ];
    titles.forEach((title) => {
      title.removeClass("mwv-note-browser-native-title");
      if (fallbackTitle) {
        title.setText(fallbackTitle);
        title.setAttribute("title", fallbackTitle);
      }
    });
    this.noteBrowserNativeBindings.delete(leaf);
    this.noteBrowserNativeBindingRecords.delete(binding);
  }

  restoreStaleNoteBrowserNativeBindings(): void {
    for (const binding of [...this.noteBrowserNativeBindingRecords]) {
      if (!this.isNoteBrowserLeaf(binding.leaf)) this.restoreNoteBrowserNativeBinding(binding);
    }
  }

  isNoteDrawWebviewToolbarVisible(controller?: NoteDrawControllerLike | null): boolean {
    const toolbar =
      controller?.toolbar ??
      controller?.previewEl?.querySelector<HTMLElement>(".notedraw-toolbar") ??
      null;
    if (!toolbar?.isConnected) return false;
    const style = window.getComputedStyle(toolbar);
    const rect = toolbar.getBoundingClientRect();
    return Boolean(
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || "1") > 0 &&
      rect.width > 2 &&
      rect.height > 2 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    );
  }

  deactivateNoteDrawControllerFromHeader(controller: NoteDrawControllerLike, surface: HTMLElement): boolean {
    if (!this.noteDrawControllerBelongsToRoot(controller, surface)) return false;
    const afterDeactivation = () => {
      if (this.isNoteDrawControllerActive(controller)) {
        controller.active = false;
        this.closeNoteDrawShell(controller.previewEl ?? surface);
      }
      controller.active = false;
      controller.button?.removeClass("is-active");
      for (const element of [controller.previewEl, controller.toolbar, controller.formatToolbar, controller.palettePanel, controller.textPanel, controller.selectionMenu, controller.canvas]) {
        element?.removeClass("is-drawing-active");
        element?.removeClass("is-notedraw-controls-visible");
        element?.removeClass("is-palette-open");
        element?.removeClass("is-text-panel-open");
        element?.removeClass("is-selection-menu-open");
        element?.removeClass("is-edit-md-mode");
        element?.removeClass("is-select-mode");
      }
      this.syncNoteDrawHeaderButtonState(surface, controller);
      this.queueNoteDrawButtonDedupe(surface);
      this.queueNoteDrawControllerSync(surface, false);
      this.queueNoteDrawDrawingSave(controller);
    };
    if (typeof controller.toggle !== "function") {
      afterDeactivation();
      return true;
    }
    try {
      void Promise.resolve(controller.toggle())
        .catch((error) => {
          console.error("[mobile-webviewer] NoteDraw header close failed", error);
        })
        .then(afterDeactivation);
      window.setTimeout(afterDeactivation, 80);
      window.setTimeout(afterDeactivation, 260);
      return true;
    } catch (error) {
      console.error("[mobile-webviewer] NoteDraw header close failed", error);
      afterDeactivation();
      return true;
    }
  }

  findNoteDrawWebviewSourceButton(root?: HTMLElement): NoteDrawButtonElement | null {
    const scopes = this.getNoteDrawSearchScopes(root);
    for (const scope of scopes) {
      const buttons = Array.from(scope.querySelectorAll<NoteDrawButtonElement>(".notedraw-webview-button")).filter((button) => {
        if (!button.isConnected || button.hasClass("mwv-notedraw-launcher") || button.hasClass("notedraw-header-button")) return false;
        const controller = button._noteDrawController;
        if (controller?.surfaceType !== "webview") return false;
        const previewEl = controller.previewEl;
        return Boolean(
          previewEl && this.isMobileWebviewerSurface(previewEl) &&
          (!root || previewEl === root || root.contains(previewEl) || previewEl.contains(root))
        );
      });
      const anchored = buttons.find((button) => Boolean(button.closest(".mwv-notedraw-anchor")));
      if (anchored ?? buttons[0]) return anchored ?? buttons[0];
    }
    return null;
  }

  dispatchHiddenActivationClick(target: HTMLElement): void {
    const rect = target.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2 || 0;
    const clientY = rect.top + rect.height / 2 || 0;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const event = type.startsWith("pointer")
        ? new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: "mouse",
            clientX,
            clientY
          })
        : new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX,
            clientY
          });
      target.dispatchEvent(event);
    }
  }

  tryActivateNoteDrawHeader(surface: HTMLElement, token: number, attempt: number): void {
    if (!surface.isConnected || this.noteDrawHeaderActivationTokens.get(surface) !== token) return;
    this.refreshNoteDrawWorkspaceBinding(surface, true, attempt === 0 || attempt === 2);
    const controller = this.findWebviewNoteDrawController(surface, true);
    if (controller) {
      this.syncNoteDrawHeaderButtonState(surface, controller);
    }

    if (controller && this.isNoteDrawControllerMounted(controller)) {
      this.noteDrawHeaderActivationTokens.delete(surface);
      if (this.toggleMountedNoteDrawController(controller, surface)) return;
    }

    const delays = [0, 80, 180, 360, 720, 1200];
    if (attempt < delays.length - 1) {
      window.setTimeout(() => this.tryActivateNoteDrawHeader(surface, token, attempt + 1), delays[attempt + 1]);
      return;
    }

    this.noteDrawHeaderActivationTokens.delete(surface);
    if (controller) {
      this.toggleMountedNoteDrawController(controller, surface, true);
      return;
    }
    void this.addConsole("warn", "NoteDraw webview controller not ready after activation retries", surface.dataset.url ?? "");
  }

  isNoteDrawControllerMounted(controller?: NoteDrawControllerLike | null): boolean {
    const previewEl: NoteDrawSurfaceElement | undefined = controller?.previewEl;
    if (!controller || !previewEl?.isConnected) return false;
    return Boolean(
      previewEl._noteDrawController === controller &&
      (controller.toolbar?.isConnected || controller.canvas?.isConnected || previewEl.querySelector(".notedraw-toolbar, .notedraw-canvas"))
    );
  }

  repairStaleNoteDrawController(surface?: HTMLElement | null): void {
    if (!surface?.isConnected || !this.isNoteWebOwnedElement(surface) || this.noteDrawControllerRepairs.has(surface)) return;
    this.noteDrawControllerRepairs.add(surface);
    void this.resetNoteDrawWebviewControllers(surface)
      .then(() => {
        if (!surface.isConnected) return;
        const noteDrawPlugin = this.getNoteDrawPlugin();
        noteDrawPlugin?.syncWebviewControllers?.();
        this.queueNoteDrawButtonDedupe(surface);
        this.queueNoteDrawControllerSync(surface, false);
      })
      .catch((error) => {
        console.error("[mobile-webviewer] NoteDraw controller repair failed", error);
      })
      .finally(() => {
        window.setTimeout(() => this.noteDrawControllerRepairs.delete(surface), 700);
      });
  }

  toggleMountedNoteDrawController(controller: NoteDrawControllerLike, surface: HTMLElement, allowUnready = false): boolean {
    if (!this.noteDrawControllerBelongsToRoot(controller, surface)) return false;
    if (!allowUnready && !this.isNoteDrawControllerMounted(controller)) return false;
    const afterActivation = () => {
      this.ensureNoteDrawControllerButtonAnchored(controller);
      const active = this.isNoteDrawControllerActive(controller);
      this.syncNoteDrawHeaderButtonState(surface, controller);
      this.queueNoteDrawButtonDedupe(surface);
      this.queueNoteDrawControllerSync(surface, active);
      if (active) {
        controller.scheduleLayoutRefresh?.();
        controller.updateFloatingControlsPosition?.();
      }
    };
    if (this.isNoteDrawControllerActive(controller)) {
      afterActivation();
      return true;
    }
    if (typeof controller.toggle !== "function") return false;
    try {
      void Promise.resolve(controller.toggle())
        .catch((error) => {
          console.error("[mobile-webviewer] NoteDraw header toggle failed", error);
        })
        .then(afterActivation);
      afterActivation();
      window.setTimeout(afterActivation, 80);
      window.setTimeout(afterActivation, 260);
      return true;
    } catch (error) {
      console.error("[mobile-webviewer] NoteDraw header toggle failed", error);
      return false;
    }
  }

  syncNoteDrawHeaderButtonState(surface: HTMLElement, controller?: NoteDrawControllerLike | null): void {
    const button = this.findNoteDrawWebviewSourceButton(surface);
    if (!button || !controller) return;
    button.toggleClass("is-active", this.isNoteDrawControllerActive(controller));
  }

  getNoteDrawSearchScopes(root?: HTMLElement): HTMLElement[] {
    const scopes: HTMLElement[] = [];
    if (root?.isConnected) {
      if (!this.isNoteDrawSurfaceElement(root)) return scopes;
      scopes.push(root);
      const leaf = root.closest<HTMLElement>(".workspace-leaf-content");
      if (leaf) scopes.push(leaf);
    }
    return [...new Set(scopes)];
  }

  findNoteDrawSourceButton(root?: HTMLElement): NoteDrawButtonElement | null {
    const scopes = this.getNoteDrawSearchScopes(root);

    for (const scope of scopes) {
      const buttons = Array.from(scope.querySelectorAll<HTMLElement>(NOTEDRAW_BUTTON_SELECTOR)).filter((candidate) => {
        if (!candidate.isConnected || candidate.hasClass("mwv-notedraw-launcher") || candidate.hasClass("notedraw-header-button")) return false;
        const controller = (candidate as NoteDrawButtonElement)._noteDrawController;
        return Boolean(controller && this.noteDrawControllerBelongsToRoot(controller, root));
      });
      const direct = buttons.find((candidate) => {
        const controller = (candidate as NoteDrawButtonElement)._noteDrawController;
        const previewEl = controller?.previewEl;
        return previewEl === root || Boolean(previewEl && root?.contains(previewEl));
      });
      const webview = buttons.find((candidate) => {
        const controller = (candidate as NoteDrawButtonElement)._noteDrawController;
        const previewEl = controller?.previewEl;
        return candidate.hasClass("notedraw-webview-button") && Boolean(
          controller && previewEl && this.isMobileWebviewerSurface(previewEl) &&
          (!root || previewEl === root || Boolean(root.contains(previewEl) || previewEl.contains(root)))
        );
      });
      const fallback = buttons.find((candidate) => {
        const controller = (candidate as NoteDrawButtonElement)._noteDrawController;
        return Boolean(controller && this.noteDrawControllerBelongsToRoot(controller, root));
      });
      const picked = direct ?? webview ?? fallback;
      if (picked) return picked;
    }
    return null;
  }

  collectNoteDrawControllers(root?: HTMLElement): NoteDrawControllerLike[] {
    if (!root?.isConnected || !this.isNoteDrawSurfaceElement(root)) return [];
    const scopes = this.getNoteDrawSearchScopes(root);

    const controllers: NoteDrawControllerLike[] = [];
    const seen = new Set<NoteDrawControllerLike>();
    const add = (controller?: NoteDrawControllerLike | null) => {
      if (!controller || seen.has(controller)) return;
      if (!this.noteDrawControllerBelongsToRoot(controller, root)) return;
      seen.add(controller);
      controllers.push(controller);
    };

    for (const scope of scopes) {
      add((scope as NoteDrawSurfaceElement)._noteDrawController);
      scope.querySelectorAll<NoteDrawSurfaceElement>(".notedraw-shell, .is-drawing-active, .mwv-root, .mwv-note-embed, .mwv-embed").forEach((surface) => {
        add(surface._noteDrawController);
      });
      scope.querySelectorAll<NoteDrawButtonElement>(NOTEDRAW_BUTTON_SELECTOR).forEach((button) => {
        if (!button.hasClass("mwv-notedraw-launcher")) add(button._noteDrawController);
      });
    }
    const noteDrawPlugin = this.getNoteDrawPlugin();
    noteDrawPlugin?.webviewControllers?.forEach((controller, surface) => {
      if (!surface?.isConnected) return;
      if (!root || surface === root || root.contains(surface) || surface.contains(root)) add(controller);
      else if (scopes.some((scope) => scope.contains(surface) || surface.contains(scope))) add(controller);
    });
    return controllers;
  }

  isNoteDrawControllerActive(controller?: NoteDrawControllerLike | null): boolean {
    if (!controller) return false;
    return Boolean(
      controller.active ||
      controller.button?.hasClass("is-active") ||
      controller.toolbar?.hasClass("is-drawing-active") ||
      controller.canvas?.hasClass("is-drawing-active") ||
      controller.previewEl?.hasClass("is-drawing-active") ||
      controller.previewEl?.querySelector?.(".is-drawing-active")
    );
  }

  findActiveNoteDrawController(root?: HTMLElement): NoteDrawControllerLike | null {
    return this.collectNoteDrawControllers(root).find((controller) => this.isNoteDrawControllerActive(controller)) ?? null;
  }

  findWebviewNoteDrawController(root?: HTMLElement, preferActive = false): NoteDrawControllerLike | null {
    const controllers = this.collectNoteDrawControllers(root).filter((controller) => {
      if (controller.surfaceType !== "webview") return false;
      const previewEl = controller.previewEl;
      return Boolean(
        this.isMobileWebviewerSurface(previewEl) &&
        (!root || previewEl === root || Boolean(previewEl && (root.contains(previewEl) || previewEl.contains(root))))
      );
    });
    if (preferActive) {
      return controllers.find((controller) => this.isNoteDrawControllerActive(controller)) ?? controllers[0] ?? null;
    }
    return controllers[0] ?? null;
  }

  findNoteDrawPreviewController(root?: HTMLElement, preferActive = false): NoteDrawControllerLike | null {
    const controllers = this.collectNoteDrawControllers(root).filter((controller) => {
      if (controller.surfaceType !== "preview") return false;
      if (!this.noteDrawControllerBelongsToRoot(controller, root)) return false;
      return this.isNoteDrawControllerMounted(controller);
    });
    if (preferActive) {
      return controllers.find((controller) => this.isNoteDrawControllerActive(controller)) ?? controllers[0] ?? null;
    }
    return controllers[0] ?? null;
  }

  handleNoteDrawWebNoteEditEvent(event: Event): void {
    if ((event as MobileWebviewerSyntheticEvent)._mwvSyntheticWebNoteSave) return;
    const target = isHtmlElement(event.target) ? event.target : null;
    if (!target) return;

    const fromFormatToolbar = Boolean(target.closest(".notedraw-format-toolbar"));
    const fromEditable =
      Boolean(target.closest(".notedraw-editing, .mwv-webnote-editor, .mwv-note-content, .mwv-md-content")) ||
      event.type === "paste";
    if (!fromFormatToolbar && !fromEditable) return;

    let surface =
      target.closest<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR) ??
      target.closest<HTMLElement>(".notedraw-shell")?.closest<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR);
    if (!surface && fromFormatToolbar) {
      const controller = this.findActiveNoteDrawController(this.app.workspace.containerEl);
      const previewEl = controller?.previewEl;
      if (this.isMobileWebviewerSurface(previewEl)) {
        surface = previewEl?.matches(MWV_DEDUPE_ROOT_SELECTOR)
          ? previewEl
          : previewEl?.closest<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR) ?? undefined;
      }
    }
    if (!surface) return;
    if (!this.isNoteWebOwnedElement(surface)) return;

    const saveDelay = fromFormatToolbar ? 80 : 0;
    window.setTimeout(() => this.queueWebNoteSaveForSurface(surface, fromFormatToolbar), saveDelay);
    this.queueNoteDrawControllerSync(surface, false);
  }

  queueWebNoteSaveForSurface(surface: HTMLElement, immediate = false): void {
    if (!this.isNoteWebOwnedElement(surface)) return;
    const root = surface.matches(MWV_DEDUPE_ROOT_SELECTOR)
      ? surface
      : surface.closest<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR);
    if (!root?.isConnected) return;

    const editor = root.querySelector<HTMLElement>(".mwv-webnote-editor");
    if (!editor) return;
    const status = root.querySelector<HTMLElement>(".mwv-webnote-status") ?? undefined;
    const view = this.app.workspace
      .getLeavesOfType(VIEW_TYPE)
      .map((leaf) => leaf.view)
      .find((candidate): candidate is MobileWebviewerView => candidate instanceof MobileWebviewerView && candidate.containerEl.contains(root));

    if (view) {
      if (immediate) {
        void view.saveCurrentWebNoteNow(status);
      } else {
        view.queueWebNoteSave(status);
      }
      return;
    }

    if (immediate) {
      const panel = root.querySelector<WebNotePanelElement>(".mwv-reader-panel");
      if (panel?._mwvFlushWebNote) {
        void Promise.resolve(panel._mwvFlushWebNote()).catch((error) => {
          console.error("[mobile-webviewer] immediate reader flush failed", error);
        });
        return;
      }
    }

    const synthetic = new Event("input", { bubbles: true }) as MobileWebviewerSyntheticEvent;
    synthetic._mwvSyntheticWebNoteSave = true;
    editor.dispatchEvent(synthetic);
  }

  queueNoteDrawControllerSync(root?: HTMLElement, forceEditMode = false): void {
    if (!root?.isConnected || !this.isNoteDrawSurfaceElement(root)) return;
    if (this.isNoteBrowserWebMode(root) && !this.isNoteBrowserRawEditingMode(root)) return;
    for (const delay of [0, 80, 220, 520]) {
      window.setTimeout(() => {
        if (!root.isConnected || (this.isNoteBrowserWebMode(root) && !this.isNoteBrowserRawEditingMode(root))) return;
        this.syncNoteDrawControllers(root, forceEditMode);
      }, delay);
    }
  }

  queueNoteDrawControllerRestore(root?: HTMLElement): void {
    if (!root?.isConnected || !this.isNoteDrawSurfaceElement(root) || this.isNoteBrowserWebMode(root)) return;
    const noteDrawPlugin = this.getNoteDrawPlugin();
    if (typeof noteDrawPlugin?.syncWebviewControllers !== "function") return;
    const token = ++this.noteDrawControllerRestoreSeq;
    this.noteDrawControllerRestoreTokens.set(root, token);
    // Web mode intentionally destroys the raw-page controller. Recreate it
    // only after the Note presentation is active, and retry across NoteDraw's
    // own async mount/layout passes so the wand cannot disappear on return.
    for (const delay of [0, 80, 220, 520, 1000, 1800]) {
      window.setTimeout(() => {
        if (
          !root.isConnected ||
          this.noteDrawControllerRestoreTokens.get(root) !== token ||
          this.isNoteBrowserWebMode(root)
        ) return;
        try {
          noteDrawPlugin.syncWebviewControllers?.();
        } catch (error) {
          console.warn("[mobile-webviewer] NoteDraw webview restore skipped", error);
        }
        this.queueNoteDrawButtonDedupe(root);
        this.queueNoteDrawControllerSync(root, true);
      }, delay);
    }
  }

  syncNoteDrawControllers(root?: HTMLElement, forceEditMode = false): void {
    if (!root?.isConnected || !this.isNoteDrawSurfaceElement(root)) return;
    if (this.isNoteBrowserWebMode(root) && !this.isNoteBrowserRawEditingMode(root)) return;
    for (const controller of this.collectNoteDrawControllers(root)) {
      if (!controller.previewEl?.isConnected || controller.surfaceType !== "webview") continue;
      if (!this.isMobileWebviewerSurface(controller.previewEl)) continue;
      if (!this.isNoteDrawControllerMounted(controller)) {
        this.repairStaleNoteDrawController(controller.previewEl);
        continue;
      }

      controller.allowTextEdit = true;
      this.ensureNoteWebElementSelectButton(controller, root);
      if (this.isNoteBrowserRawEditingMode(root)) {
        this.bindNoteDrawRawToolButtons(controller, root);
        this.syncNoteWebRawDrawingState(root, controller);
      }

      const active = this.isNoteDrawControllerActive(controller);
      const currentEditor = controller.currentEditor;
      if (active && !currentEditor && forceEditMode && controller.toolMode === "edit-md") {
        try {
          this.setNoteDrawWebviewTool(controller, "select");
        } catch (error) {
          console.warn("[mobile-webviewer] NoteDraw selection mode skipped", error);
        }
      }

      if (controller.currentEditor?.isConnected) {
        controller.formatToolbar?.addClass("is-visible");
        try {
          controller.positionFormatToolbar?.();
        } catch (error) {
          console.warn("[mobile-webviewer] NoteDraw toolbar position skipped", error);
        }
        this.queueWebNoteSaveForSurface(controller.previewEl);
        continue;
      }

      try {
        controller.applyWebEdits?.();
        controller.resizeCanvas?.();
        controller.render?.();
        this.queueNoteDrawDrawingSave(controller);
      } catch (error) {
        console.warn("[mobile-webviewer] NoteDraw controller sync skipped", error);
      }
    }
    this.queueLegacyNoteDrawWebviewerMigration(root);
  }

  queueLegacyNoteDrawWebviewerMigration(root?: HTMLElement): void {
    const documentEl =
      root?.closest<HTMLElement>(".mwv-note-browser-document") ??
      root?.querySelector<HTMLElement>(".mwv-note-browser-document") ??
      null;
    if (!documentEl) return;
    if (!this.isNoteWebOwnedElement(documentEl)) return;
    if (this.isNoteBrowserWebMode(documentEl)) return;
    if (this.settings.noteDrawLegacyWebviewerMigrationVersion >= NOTEDRAW_LEGACY_WEBVIEWER_MIGRATION_VERSION) {
      documentEl.addClass("mwv-notedraw-legacy-migrated");
      return;
    }
    if (this.noteDrawLegacyMigrationPromise || this.noteDrawLegacyMigrationTimer) return;
    const runMigration = () => {
      const migration = this.migrateLegacyNoteDrawWebviewer(documentEl)
        .catch((error) => {
          console.warn("[mobile-webviewer] legacy NoteDraw migration skipped", error);
          return false;
        });
      this.noteDrawLegacyMigrationPromise = migration;
      void migration.then((completed) => {
        this.noteDrawLegacyMigrationPromise = null;
        if (completed) {
          this.noteDrawLegacyMigrationRetry = 0;
        } else if (documentEl.isConnected) {
          this.noteDrawLegacyMigrationRetry += 1;
          this.queueLegacyNoteDrawWebviewerMigration(documentEl);
        }
      });
    };
    if (this.noteDrawLegacyMigrationRetry === 0) {
      runMigration();
      return;
    }
    this.noteDrawLegacyMigrationTimer = window.setTimeout(() => {
      this.noteDrawLegacyMigrationTimer = 0;
      runMigration();
    }, [800, 1600, 3200, 6000, 10000][Math.min(this.noteDrawLegacyMigrationRetry - 1, 4)]);
  }

  async migrateLegacyNoteDrawWebviewer(documentEl: HTMLElement): Promise<boolean> {
    if (!documentEl.isConnected || !this.isNoteWebOwnedElement(documentEl)) return false;
    if (this.isNoteBrowserWebMode(documentEl)) return false;
    const noteDrawPlugin = this.getNoteDrawPlugin();
    const noteDrawApi = noteDrawPlugin?.api;
    if (typeof noteDrawApi?.readDrawings !== "function" || typeof noteDrawApi.writeDrawings !== "function") return false;

    const legacyController = (documentEl as NoteDrawSurfaceElement)._noteDrawController;
    if (legacyController?.surfaceType !== "preview" || legacyController.file?.path !== WEBVIEW_NOTE_PATH) return false;
    const homeController = this.collectNoteDrawControllers(documentEl).find((controller) => {
      const surface = controller.previewEl;
      if (controller.surfaceType !== "webview" || !surface?.isConnected || !surface.matches(".mwv-bing-home")) return false;
      return this.sameWebPage(surface.dataset.url, this.settings.homeUrl);
    });
    const homeFile = homeController?.file ?? this.noteDrawWebviewFileForUrl(this.settings.homeUrl);
    if (!homeFile?.path) return false;

    await Promise.all([
      legacyController.ensureDrawingsLoaded?.(),
      homeController?.ensureDrawingsLoaded?.()
    ]);
    const [legacyData, homeData] = await Promise.all([
      noteDrawApi.readDrawings(legacyController.file),
      noteDrawApi.readDrawings(homeFile)
    ]);
    const legacyCounts = this.noteDrawDataCounts(legacyData);
    const homeCounts = this.noteDrawDataCounts(homeData);
    const homeAlreadyContainsLegacy = this.noteDrawContentMatches(homeData, legacyData);
    if (legacyCounts.total === 0 || (homeCounts.total !== 0 && !homeAlreadyContainsLegacy)) return true;

    const pendingSave = homeController ? this.noteDrawDrawingSaveTimers.get(homeController) : 0;
    if (pendingSave && homeController) {
      window.clearTimeout(pendingSave);
      this.noteDrawDrawingSaveTimers.delete(homeController);
    }

    const migrated = JSON.parse(JSON.stringify(legacyData)) as NoteDrawDrawingDataLike;
    migrated.sourcePath = homeFile.path;
    migrated.updatedAt = new Date().toISOString();
    migrated.strokes = (migrated.strokes ?? []).map((item) => {
      return this.rebaseLegacyNoteDrawStroke(item, homeFile.path ?? "");
    });
    await noteDrawApi.writeDrawings(homeFile, migrated);
    const verified = await noteDrawApi.readDrawings(homeFile);
    const verifiedCounts = this.noteDrawDataCounts(verified);
    if (
      verifiedCounts.strokes !== legacyCounts.strokes ||
      verifiedCounts.webEdits !== legacyCounts.webEdits ||
      this.noteDrawDataHasForeignAnchors(verified, homeFile.path ?? "")
    ) {
      throw new Error("NoteDraw homepage migration readback did not match the legacy data");
    }

    this.settings.noteDrawLegacyWebviewerMigrationVersion = NOTEDRAW_LEGACY_WEBVIEWER_MIGRATION_VERSION;
    await this.saveSettings();
    documentEl.addClass("mwv-notedraw-legacy-migrated");
    homeController?.applyWebEdits?.();
    homeController?.resizeCanvas?.();
    homeController?.render?.();
    return true;
  }

  noteDrawDataCounts(data?: NoteDrawDrawingDataLike | null): { strokes: number; webEdits: number; total: number } {
    const strokes = Array.isArray(data?.strokes) ? data.strokes.length : 0;
    const webEdits = Array.isArray(data?.webEdits) ? data.webEdits.length : 0;
    return { strokes, webEdits, total: strokes + webEdits };
  }

  noteDrawContentMatches(left?: NoteDrawDrawingDataLike | null, right?: NoteDrawDrawingDataLike | null): boolean {
    const exactMatch = (
      JSON.stringify(left?.strokes ?? []) === JSON.stringify(right?.strokes ?? []) &&
      JSON.stringify(left?.webEdits ?? []) === JSON.stringify(right?.webEdits ?? [])
    );
    if (exactMatch) return true;
    const strokeIds = (data?: NoteDrawDrawingDataLike | null) => {
      return (data?.strokes ?? []).map((item) => {
        if (!item || typeof item !== "object") return "";
        const layout = (item as Record<string, unknown>).layout;
        return layout && typeof layout === "object" ? String((layout as Record<string, unknown>).id ?? "") : "";
      });
    };
    const leftIds = strokeIds(left);
    const rightIds = strokeIds(right);
    return (
      leftIds.length > 0 &&
      leftIds.length === rightIds.length &&
      leftIds.every(Boolean) &&
      JSON.stringify(leftIds) === JSON.stringify(rightIds) &&
      JSON.stringify(left?.webEdits ?? []) === JSON.stringify(right?.webEdits ?? [])
    );
  }

  rebaseLegacyNoteDrawStroke(item: unknown, targetPath: string): unknown {
    if (!item || typeof item !== "object") return item;
    const stroke = item as Record<string, unknown>;
    const layout = stroke.layout;
    if (layout && typeof layout === "object") {
      const corners = (layout as Record<string, unknown>).corners;
      if (corners && typeof corners === "object") {
        for (const corner of Object.values(corners)) {
          if (corner && typeof corner === "object") (corner as Record<string, unknown>).path = targetPath;
        }
      }
    }
    if (Array.isArray(stroke.points)) {
      stroke.points = stroke.points.map((itemPoint) => {
        if (!itemPoint || typeof itemPoint !== "object") return itemPoint;
        const point = itemPoint as Record<string, unknown>;
        const anchor = point.anchor;
        if (anchor && typeof anchor === "object") (anchor as Record<string, unknown>).path = targetPath;
        return point;
      });
    }
    return stroke;
  }

  noteDrawDataHasForeignAnchors(data: NoteDrawDrawingDataLike | null | undefined, targetPath: string): boolean {
    return (data?.strokes ?? []).some((item) => {
      if (!item || typeof item !== "object") return false;
      const stroke = item as Record<string, unknown>;
      const layout = stroke.layout;
      if (layout && typeof layout === "object") {
        const corners = (layout as Record<string, unknown>).corners;
        if (corners && typeof corners === "object") {
          const hasForeignCorner = Object.values(corners).some((corner) => {
            return Boolean(corner && typeof corner === "object" && (corner as Record<string, unknown>).path !== targetPath);
          });
          if (hasForeignCorner) return true;
        }
      }
      return Array.isArray(stroke.points) && stroke.points.some((itemPoint) => {
        if (!itemPoint || typeof itemPoint !== "object") return false;
        const anchor = (itemPoint as Record<string, unknown>).anchor;
        return Boolean(anchor && typeof anchor === "object" && (anchor as Record<string, unknown>).path !== targetPath);
      });
    });
  }

  sameWebPage(left?: string, right?: string): boolean {
    const normalize = (value?: string) => {
      try {
        const url = new URL(value || "");
        url.hash = "";
        return url.href.replace(/\/$/, "").toLowerCase();
      } catch {
        return String(value || "").trim().replace(/\/$/, "").toLowerCase();
      }
    };
    return Boolean(left && right && normalize(left) === normalize(right));
  }

  noteDrawWebviewFileForUrl(value?: string): NoteDrawFileLike | null {
    let identity = "";
    try {
      identity = new URL(value || "").toString();
    } catch {
      identity = String(value || "").trim();
    }
    if (!identity) return null;
    let label = "webview";
    try {
      label = new URL(identity).hostname.replace(/^www\./, "") || label;
    } catch {
      // Keep the generic label for non-URL identities.
    }
    label = label
      .replace(/\\/g, "/")
      .split("/")
      .pop()!
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "webview";
    let hash = 2166136261;
    for (let index = 0; index < identity.length; index += 1) {
      hash ^= identity.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const suffix = (hash >>> 0).toString(16).padStart(8, "0");
    const path = `webviews/${label}__${suffix}.md`;
    return { path, name: path.split("/").pop() || "webview.md", extension: "md" };
  }

  queueNoteDrawDrawingSave(controller?: NoteDrawControllerLike | null): void {
    if (!controller?.file || !this.isNoteDrawSurfaceElement(controller.previewEl)) return;
    const data = (controller as NoteDrawControllerLike & { drawingData?: unknown }).drawingData;
    if (!data) return;
    const existing = this.noteDrawDrawingSaveTimers.get(controller);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      this.noteDrawDrawingSaveTimers.delete(controller);
      const plugin = this.getNoteDrawPlugin();
      if (typeof plugin?.writeDrawings !== "function" || !controller.file) return;
      void plugin.writeDrawings(controller.file, data).catch((error) => {
        console.warn("[mobile-webviewer] NoteDraw drawing autosave skipped", error);
      });
    }, 900);
    this.noteDrawDrawingSaveTimers.set(controller, timer);
  }

  isRawNoteDrawExcludedSurface(element?: Element | null): boolean {
    if (!element) return false;
    const selector = ".mwv-root.is-raw-web, .mwv-root[data-notedraw-ignore], .mwv-embed.is-web-front, .mwv-embed[data-notedraw-ignore], .mwv-note-embed.is-web-front, .mwv-bing-home.is-web-front";
    try {
      const rawRoot = element.matches(selector)
        ? element
        : element.closest(selector) ?? element.querySelector(selector);
      // A user explicitly opened the NoteDraw editor for this one raw page.
      // Keep all other raw Web surfaces excluded before NoteDraw mounts.
      if (rawRoot instanceof HTMLElement && rawRoot.dataset.mwvNotewebElementEdit === "true") return false;
      return Boolean(
        element.matches(selector) ||
        element.closest(selector) ||
        element.querySelector(selector)
      );
    } catch {
      return false;
    }
  }

  getNoteDrawDocuments(): Document[] {
    const activeWindow = (window as Window & { activeWindow?: Window }).activeWindow;
    return [...new Set([
      appDocument(),
      window.document,
      activeWindow?.document
    ].filter((documentEl): documentEl is Document => Boolean(documentEl)))];
  }

  isRawNoteWebLeaf(leaf?: WorkspaceLeaf | null): boolean {
    if (!this.isNoteBrowserLeaf(leaf)) return false;
    const container = leaf?.view?.containerEl;
    return Boolean(container?.querySelector?.(
      ".mwv-embed.is-web-front, .mwv-note-embed.is-web-front, .mwv-bing-home.is-web-front"
    ));
  }

  runNoteDrawWithoutRawNoteWebLeaves<T>(task: () => T): T {
    const workspace = this.app.workspace as typeof this.app.workspace & {
      getLeavesOfType?: (viewType?: string) => WorkspaceLeaf[];
    };
    const nativeGetLeavesOfType = workspace.getLeavesOfType;
    if (typeof nativeGetLeavesOfType !== "function") return task();
    const guardedGetLeavesOfType = (viewType?: string): WorkspaceLeaf[] => {
      const leaves = (nativeGetLeavesOfType.call(workspace, viewType) ?? []) as WorkspaceLeaf[];
      if (viewType !== "markdown") return leaves;
      return leaves.filter((leaf) => !this.isRawNoteWebLeaf(leaf));
    };
    try {
      workspace.getLeavesOfType = guardedGetLeavesOfType;
    } catch {
      return task();
    }
    try {
      return task();
    } finally {
      if (workspace.getLeavesOfType === guardedGetLeavesOfType) {
        workspace.getLeavesOfType = nativeGetLeavesOfType;
      }
    }
  }

  installNoteDrawMarkdownSyncGuards(plugin: NoteDrawPluginLike): void {
    const keys: Array<"syncRenderedMarkdownAnnotations" | "syncSourceControllers" | "syncMarkdownControllerModes" | "syncEmbeddedMarkdownControllers"> = [
      "syncRenderedMarkdownAnnotations",
      "syncSourceControllers",
      "syncMarkdownControllerModes",
      "syncEmbeddedMarkdownControllers"
    ];
    for (const key of keys) {
      const original = plugin[key];
      if (typeof original !== "function") continue;
      if (this.noteDrawRawSurfaceGuardMethodPatches.some((patch) => patch.plugin === plugin && patch.key === key)) continue;
      const wrapper = (...args: unknown[]) => this.runNoteDrawWithoutRawNoteWebLeaves(() => original.apply(plugin, args));
      plugin[key] = wrapper as never;
      this.noteDrawRawSurfaceGuardMethodPatches.push({ plugin, key, original, wrapper });
    }
  }

  installNoteDrawRawSurfaceGuard(): void {
    const attempt = () => {
      const plugin = this.getNoteDrawPlugin();
      if (!plugin) return;
      if (
        this.noteDrawRawSurfaceGuardWrapper &&
        this.noteDrawRawSurfaceGuardPlugin === plugin &&
        plugin.syncWebviewControllers === this.noteDrawRawSurfaceGuardWrapper
      ) return;
      // NoteDraw can be reloaded independently while Mobile Webviewer stays
      // enabled. Rebind every guard to the replacement plugin instance.
      if (this.noteDrawRawSurfaceGuardWrapper) this.restoreNoteDrawRawSurfaceGuard();
      const original = plugin?.syncWebviewControllers;
      if (typeof original !== "function") return;

      const guarded = original.bind(plugin);
      const wrapper = () => {
        // NoteDraw's own observer calls this method asynchronously. During the
        // scan, filter only raw Mobile Webviewer candidates at the DOM query
        // boundary. This prevents PreviewDrawingController.mount() from ever
        // touching the real page; post-mount hiding cannot prevent layout
        // changes that have already happened.
        const documents = this.getNoteDrawDocuments();
        const patches: Array<{ documentEl: Document; descriptor?: PropertyDescriptor }> = [];
        const patchDocument = (documentEl: Document) => {
          const nativeQuerySelectorAll = documentEl.querySelectorAll.bind(documentEl);
          const ownDescriptor = Object.getOwnPropertyDescriptor(documentEl, "querySelectorAll");
          const guardedQuerySelectorAll = (selectors: string): NodeListOf<Element> => {
            const result = nativeQuerySelectorAll(selectors);
            if (!this.noteDrawRawSurfaceGuardRunning || typeof selectors !== "string") return result;
            if (!/(mwv-embed|webview|iframe|view-content|browser)/i.test(selectors)) return result;
            const filtered = Array.from(result).filter((candidate) => !this.isRawNoteDrawExcludedSurface(candidate as Element));
            return filtered as unknown as NodeListOf<Element>;
          };
          try {
            Object.defineProperty(documentEl, "querySelectorAll", {
              configurable: true,
              value: guardedQuerySelectorAll
            });
            patches.push({ documentEl, descriptor: ownDescriptor });
          } catch {
            // A host document may be non-extensible; other documents can still
            // be guarded and the controller sweep below remains as a fallback.
          }
        };

        if (this.noteDrawRawSurfaceGuardRunning) {
          guarded();
          return;
        }
        this.noteDrawRawSurfaceGuardRunning = true;
        try {
          documents.forEach((documentEl) => patchDocument(documentEl));
          guarded();
        } finally {
          for (const { documentEl, descriptor } of patches) {
            if (descriptor) {
              try { Object.defineProperty(documentEl, "querySelectorAll", descriptor); } catch { /* noop */ }
            } else {
              try { Reflect.deleteProperty(documentEl, "querySelectorAll"); } catch { /* noop */ }
            }
          }
          this.noteDrawRawSurfaceGuardRunning = false;
          this.disposeAllRawNoteDrawControllers();
        }
      };

      this.noteDrawRawSurfaceGuardPlugin = plugin;
      this.noteDrawRawSurfaceGuardOriginal = original;
      this.noteDrawRawSurfaceGuardWrapper = wrapper;
      this.installNoteDrawMarkdownSyncGuards(plugin);
      plugin.syncWebviewControllers = wrapper;
      this.disposeAllRawNoteDrawControllers();
    };

    attempt();
    if (this.noteDrawRawSurfaceGuardWrapper) return;
    for (const delay of [150, 600, 1800, 4000]) {
      const timer = window.setTimeout(() => {
        this.noteDrawRawSurfaceGuardRetryTimers = this.noteDrawRawSurfaceGuardRetryTimers.filter((entry) => entry !== timer);
        attempt();
      }, delay);
      this.noteDrawRawSurfaceGuardRetryTimers.push(timer);
    }
  }

  restoreNoteDrawRawSurfaceGuard(): void {
    for (const timer of this.noteDrawRawSurfaceGuardRetryTimers) window.clearTimeout(timer);
    this.noteDrawRawSurfaceGuardRetryTimers = [];
    const plugin = this.noteDrawRawSurfaceGuardPlugin;
    if (plugin && this.noteDrawRawSurfaceGuardWrapper && plugin.syncWebviewControllers === this.noteDrawRawSurfaceGuardWrapper) {
      if (this.noteDrawRawSurfaceGuardOriginal) plugin.syncWebviewControllers = this.noteDrawRawSurfaceGuardOriginal;
    }
    for (const patch of this.noteDrawRawSurfaceGuardMethodPatches) {
      if (patch.plugin[patch.key] === patch.wrapper) {
        patch.plugin[patch.key] = patch.original as never;
      }
    }
    this.noteDrawRawSurfaceGuardMethodPatches = [];
    this.noteDrawRawSurfaceGuardPlugin = null;
    this.noteDrawRawSurfaceGuardOriginal = null;
    this.noteDrawRawSurfaceGuardWrapper = null;
  }

  collectRawNoteDrawControllers(root: HTMLElement): NoteDrawControllerLike[] {
    const controllers = new Set<NoteDrawControllerLike>();
    const add = (controller?: NoteDrawControllerLike | null) => {
      if (controller) controllers.add(controller);
    };
    add((root as NoteDrawSurfaceElement)._noteDrawController);
    root.querySelectorAll<HTMLElement>("*").forEach((element) => {
      add((element as NoteDrawSurfaceElement)._noteDrawController);
    });
    root.ownerDocument?.body?.querySelectorAll<HTMLElement>(
      ".notedraw-toolbar, .notedraw-palette-panel, .notedraw-brush-panel, .notedraw-text-panel, .notedraw-selection-menu, .notedraw-format-toolbar, .notedraw-file-input, .notedraw-body-control"
    ).forEach((element) => {
      const controller = (element as NoteDrawSurfaceElement)._noteDrawController;
      if (controller?.previewEl === root || Boolean(controller?.previewEl && root.contains(controller.previewEl))) add(controller);
    });
    const plugin = this.getNoteDrawPlugin();
    plugin?.webviewControllers?.forEach((controller, surface) => {
      if (surface === root || root.contains(surface) || controller?.previewEl === root || Boolean(controller?.previewEl && root.contains(controller.previewEl))) add(controller);
    });
    return [...controllers];
  }

  disposeNoteDrawControllersForRawSurface(root?: HTMLElement | null): void {
    if (!root?.isConnected) return;
    // A destroyed raw surface is being unloaded or replaced, so its retained
    // drawing-visibility marker must not leak into a future WebView mount.
    delete root.dataset.mwvNotewebDrawingVisible;
    const plugin = this.getNoteDrawPlugin();
    const controllers = this.collectRawNoteDrawControllers(root);
    plugin?.webviewControllers?.forEach((controller, surface) => {
      if (controllers.includes(controller) || surface === root || root.contains(surface)) plugin.webviewControllers?.delete(surface);
    });
    const documentEl = root.ownerDocument ?? appDocument();
    const ownedElements = new Set<HTMLElement>();
    const collectElement = (value: unknown) => {
      if (value instanceof HTMLElement && value.isConnected) ownedElements.add(value);
    };
    for (const controller of controllers) {
      void this.flushNoteDrawDrawingNow(controller);
      for (const key of ["button", "toolbar", "formatToolbar", "palettePanel", "brushPanel", "textPanel", "selectionMenu", "canvas", "staticCanvas", "embedLayer", "underlayEmbedLayer", "underlayCanvas", "fileInput"]) {
        collectElement((controller as NoteDrawControllerLike & Record<string, unknown>)[key]);
      }
      try { controller.destroy?.(); } catch (error) { console.warn("[mobile-webviewer] raw NoteDraw dispose skipped", error); }
    }
    const selector = ".notedraw-toolbar, .notedraw-palette-panel, .notedraw-brush-panel, .notedraw-text-panel, .notedraw-selection-menu, .notedraw-format-toolbar, .notedraw-file-input, .notedraw-body-control, .notedraw-canvas, .notedraw-static-canvas, .notedraw-embed-layer, .notedraw-underlay-embed-layer, .notedraw-underlay-canvas";
    root.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      const controller = (element as NoteDrawSurfaceElement)._noteDrawController;
      if (controller && controllers.includes(controller)) ownedElements.add(element);
    });
    documentEl.body?.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      const controller = (element as NoteDrawSurfaceElement)._noteDrawController;
      if (controller && controllers.includes(controller)) ownedElements.add(element);
    });
    ownedElements.forEach((element) => element.remove());
    (root as NoteDrawSurfaceElement)._noteDrawController = undefined;
  }

  disposeAllRawNoteDrawControllers(): void {
    const roots = new Set<HTMLElement>();
    for (const documentEl of this.getNoteDrawDocuments()) {
      documentEl.querySelectorAll<HTMLElement>(".mwv-root.is-raw-web, .mwv-embed.is-web-front, .mwv-note-embed.is-web-front, .mwv-bing-home.is-web-front")
        .forEach((root) => {
          if (root.dataset.mwvNotewebElementEdit !== "true") roots.add(root);
        });
    }
    roots.forEach((root) => this.disposeNoteDrawControllersForRawSurface(root));
    const plugin = this.getNoteDrawPlugin();
    const detached = new Set<NoteDrawControllerLike>();
    plugin?.webviewControllers?.forEach((controller, surface) => {
      const preview = controller?.previewEl;
      const isRaw = this.isRawNoteDrawExcludedSurface(surface) || this.isRawNoteDrawExcludedSurface(preview);
      if (isRaw) detached.add(controller);
    });
    for (const controller of detached) {
      plugin?.webviewControllers?.forEach((candidate, surface) => {
        if (candidate === controller) plugin.webviewControllers?.delete(surface);
      });
      const controls = ["button", "toolbar", "formatToolbar", "palettePanel", "brushPanel", "textPanel", "selectionMenu", "canvas", "staticCanvas", "embedLayer", "underlayEmbedLayer", "underlayCanvas", "fileInput"];
      for (const key of controls) {
        const element = (controller as NoteDrawControllerLike & Record<string, unknown>)[key];
        if (element instanceof HTMLElement && element.isConnected) element.remove();
      }
      void this.flushNoteDrawDrawingNow(controller);
      try { controller.destroy?.(); } catch (error) { console.warn("[mobile-webviewer] detached raw NoteDraw dispose skipped", error); }
    }
  }

  getNoteDrawPlugin(): NoteDrawPluginLike | null {
    const pluginRegistry = (this.app as AppWithRuntimePlugins).plugins;
    const plugin = pluginRegistry?.plugins?.notedraw;
    return plugin && typeof plugin === "object" ? plugin : null;
  }

  flushNoteDrawDrawingNow(controller?: NoteDrawControllerLike | null): Promise<void> {
    if (!controller?.file || !this.isNoteDrawSurfaceElement(controller.previewEl)) return Promise.resolve();
    const data = (controller as NoteDrawControllerLike & { drawingData?: unknown }).drawingData;
    if (!data) return Promise.resolve();
    const pendingTimer = this.noteDrawDrawingSaveTimers.get(controller);
    if (pendingTimer) {
      window.clearTimeout(pendingTimer);
      this.noteDrawDrawingSaveTimers.delete(controller);
    }
    const plugin = this.getNoteDrawPlugin();
    try {
      plugin?.scheduleDrawingSave?.(controller.file, data);
    } catch (error) {
      console.warn("[mobile-webviewer] NoteDraw scheduled drawing save skipped", error);
    }
    if (typeof plugin?.writeDrawings !== "function") return Promise.resolve();
    return plugin.writeDrawings(controller.file, data).catch((error) => {
      console.warn("[mobile-webviewer] NoteDraw drawing flush skipped", error);
    });
  }

  isNoteBrowserLeaf(leaf?: WorkspaceLeaf | null): boolean {
    const file = (leaf?.view as { file?: unknown } | undefined)?.file;
    return file instanceof TFile && file.path === WEBVIEW_NOTE_PATH;
  }

  /** Leaves that host a NoteDraw-capable surface: the NoteWeb note leaf and the Browser View. */
  isNoteDrawSurfaceLeaf(leaf?: WorkspaceLeaf | null): boolean {
    if (this.isNoteBrowserLeaf(leaf)) return true;
    const view = leaf?.view as { getViewType?: () => string } | undefined;
    return view?.getViewType?.() === VIEW_TYPE;
  }

  /**
   * Like isNoteWebOwnedElement, but also admits Browser View surfaces so the
   * NoteDraw magic wand can annotate real web pages exactly like NoteWeb does.
   */
  isNoteDrawSurfaceElement(element?: HTMLElement | null): boolean {
    if (!element?.isConnected) return false;
    return this.isNoteDrawSurfaceLeaf(this.findWorkspaceLeafForElement(element));
  }

  isNoteWebOwnedElement(element?: HTMLElement | null): boolean {
    if (!element?.isConnected) return false;
    return this.isNoteBrowserLeaf(this.findWorkspaceLeafForElement(element));
  }

  noteDrawControllerBelongsToRoot(controller: NoteDrawControllerLike | null | undefined, root?: HTMLElement | null): boolean {
    if (!controller || !root?.isConnected || !this.isNoteDrawSurfaceElement(root)) return false;
    const preview = controller.previewEl;
    if (!preview?.isConnected || !this.isNoteDrawSurfaceElement(preview)) return false;
    return preview === root || root.contains(preview) || preview.contains(root);
  }

  findWorkspaceLeafForElement(root?: HTMLElement): WorkspaceLeaf | null {
    if (!root?.isConnected) return null;
    let match: WorkspaceLeaf | null = null;
    const rootLeafEl = root.closest<HTMLElement>(".workspace-leaf");
    try {
      this.app.workspace.iterateAllLeaves((leaf) => {
        const container = leaf.view?.containerEl;
        const containerLeafEl = container?.closest<HTMLElement>(".workspace-leaf");
        if (!match && container && (container === root || container.contains(root) || root.contains(container) || (rootLeafEl && containerLeafEl === rootLeafEl))) {
          match = leaf;
        }
      });
    } catch (error) {
      console.warn("[mobile-webviewer] workspace leaf lookup skipped", error);
    }
    return match;
  }

  refreshNoteDrawWorkspaceBinding(root?: HTMLElement, forceEditMode = false, emitWorkspaceEvents = true): void {
    if (!root?.isConnected || !this.isNoteDrawSurfaceElement(root)) return;
    if (this.isNoteBrowserWebMode(root) && !this.isNoteBrowserRawEditingMode(root)) return;

    // Do not synthesize workspace layout/leaf/file events here. NoteDraw
    // handles those events globally and would rescan ordinary Markdown
    // leaves; the NoteWeb surface is refreshed directly below instead.

    // NoteDraw owns its global controller scheduler. We only reconcile the
    // controller already attached to this NoteWeb surface below.
    this.queueNoteDrawButtonDedupe(root);
    this.queueNoteDrawControllerSync(root, forceEditMode);
  }

  notifyNoteDrawWebviewChanged(root?: HTMLElement, forceEditMode = false): void {
    if (!root?.isConnected || !this.isNoteDrawSurfaceElement(root)) return;
    // The real web page owns the viewport in Web mode. NoteDraw's Markdown
    // virtual-height pass is for the note view and can otherwise feed the
    // live page's measured height back into the parent layout.
    if (this.isNoteBrowserWebMode(root) && !this.isNoteBrowserRawEditingMode(root)) {
      const embed = root.matches(MWV_DEDUPE_ROOT_SELECTOR) ? root : root.querySelector<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR);
      if (embed) this.applyNoteBrowserWebIsolation(embed, true);
      return;
    }
    const delays = [0, 80, 180, 420, 900, 1600];
    delays.forEach((delay, index) => {
      window.setTimeout(() => {
        if (!root.isConnected) return;
        this.refreshNoteDrawWorkspaceBinding(root, forceEditMode, index === 0 || index === 2 || index === 4);
      }, delay);
    });
  }

  async resetNoteDrawWebviewControllers(root?: HTMLElement): Promise<void> {
    if (!root?.isConnected || !this.isNoteDrawSurfaceElement(root)) return;
    delete root.dataset.mwvNotewebDrawingVisible;
    const noteDrawPlugin = this.getNoteDrawPlugin();
    const controllers = new Set<NoteDrawControllerLike>();
    const detachedControls = new Set<HTMLElement>();
    for (const controller of this.collectNoteDrawControllers(root)) {
      if (controller.surfaceType === "webview" && this.isMobileWebviewerSurface(controller.previewEl)) {
        controllers.add(controller);
      }
    }
    noteDrawPlugin?.webviewControllers?.forEach((controller, surface) => {
      if ((surface === root || root.contains(surface)) && controller?.surfaceType === "webview") {
        controllers.add(controller);
      }
    });

    noteDrawPlugin?.webviewControllers?.forEach((controller, surface) => {
      if (
        controllers.has(controller) ||
        surface === root ||
        root.contains(surface) ||
        Boolean(controller?.previewEl && (controller.previewEl === root || root.contains(controller.previewEl)))
      ) {
        noteDrawPlugin.webviewControllers?.delete(surface);
      }
    });

    for (const controller of controllers) {
      for (const key of ["button", "toolbar", "formatToolbar", "palettePanel", "brushPanel", "textPanel", "selectionMenu", "canvas", "staticCanvas", "embedLayer", "underlayEmbedLayer", "underlayCanvas", "fileInput"]) {
        const element = (controller as NoteDrawControllerLike & Record<string, unknown>)[key];
        if (element instanceof HTMLElement && element.isConnected) detachedControls.add(element);
      }
      const flush = this.flushNoteDrawDrawingNow(controller);
      try {
        controller.destroy?.();
      } catch (error) {
        console.warn("[mobile-webviewer] NoteDraw controller reset skipped", error);
      }
      await flush;
    }
    root.querySelectorAll<HTMLElement>(NOTEDRAW_BUTTON_SELECTOR).forEach((button) => button.remove());
    root.querySelectorAll<HTMLElement>(".notedraw-toolbar, .notedraw-palette-panel, .notedraw-text-panel, .notedraw-selection-menu, .notedraw-format-toolbar, .notedraw-embed-layer, .notedraw-file-input, .notedraw-canvas").forEach((element) => element.remove());
    detachedControls.forEach((element) => element.remove());
    (root as NoteDrawSurfaceElement)._noteDrawController = undefined;
  }

  async disposeInactiveNoteWebControllers(activeLeaf?: WorkspaceLeaf | null): Promise<void> {
    const roots: HTMLElement[] = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf === activeLeaf || !this.isNoteBrowserLeaf(leaf)) return;
      const container = leaf.view?.containerEl;
      if (!container?.isConnected) return;
      container.querySelectorAll<HTMLElement>(".mwv-embed[data-url]").forEach((root) => roots.push(root));
    });
    for (const root of roots) {
      if (root.isConnected) await this.resetNoteDrawWebviewControllers(root);
    }
  }

  ensureNoteDrawControllerButtonAnchored(controller?: NoteDrawControllerLike | null): void {
    const surface = controller?.previewEl;
    const button = controller?.button;
    if (!surface?.isConnected || !button?.isConnected) return;
    if (!this.isMobileWebviewerSurface(surface)) return;
    if (!controller) return;
    if (!this.isNoteDrawControllerMounted(controller)) {
      button.removeClass("mwv-notedraw-top-button");
      button.addClass("mwv-notedraw-source-button");
      button.setAttribute("aria-hidden", "true");
      button.tabIndex = -1;
      this.repairStaleNoteDrawController(surface);
      return;
    }
    if (!this.isVisibleNoteDrawSurface(surface)) {
      button.removeClass("mwv-notedraw-top-button");
      button.addClass("mwv-notedraw-source-button");
      button.setAttribute("aria-hidden", "true");
      button.tabIndex = -1;
      return;
    }
    const anchor = this.ensureNoteDrawStableAnchor(surface);
    if (button.parentElement !== anchor) {
      anchor.appendChild(button);
    }
    button.addClass("mwv-notedraw-top-button");
    button.removeClass("mwv-notedraw-source-button");
    button.removeAttribute("aria-hidden");
    button.tabIndex = 0;
    this.decorateNoteDrawWebWandButton(button);
    this.bindNoteDrawWebviewButton(button, controller);
  }

  isVisibleNoteDrawSurface(surface?: HTMLElement | null): boolean {
    if (!surface?.isConnected || !this.isNoteDrawSurfaceElement(surface)) return false;
    const rect = surface.getBoundingClientRect();
    const style = window.getComputedStyle(surface);
    return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden";
  }

  decorateNoteDrawWebWandButton(button: NoteDrawButtonElement): void {
    button.addClass("mwv-notedraw-web-wand");
    button.setAttribute("aria-label", "Web notedraw");
    button.setAttribute("title", "Web notedraw");
    if (button.dataset.mwvWebWandDecorated === "true") return;
    button.dataset.mwvWebWandDecorated = "true";
    button.empty();
    const globe = button.createSpan({ cls: "mwv-web-wand-globe", attr: { "aria-hidden": "true" } });
    setIcon(globe, "globe-2");
    const wand = button.createSpan({ cls: "mwv-web-wand-spark", attr: { "aria-hidden": "true" } });
    setIcon(wand, "wand-sparkles");
  }

  bindNoteDrawWebviewButton(button: NoteDrawButtonElement, controller: NoteDrawControllerLike): void {
    button._mwvNoteDrawBoundController = controller;
    button._mwvNoteDrawBound = true;
  }

  handleNoteDrawWebWandLifecycle(event: Event): void {
    const target = isHtmlElement(event.target)
      ? event.target.closest<NoteDrawButtonElement>(".mwv-notedraw-web-wand.notedraw-webview-button")
      : null;
    const controller = target?._mwvNoteDrawBoundController;
    if (!target || !controller || !this.isNoteWebOwnedElement(target) || !this.isNoteWebOwnedElement(controller.previewEl) || !this.isVisibleNoteDrawSurface(controller.previewEl)) return;
    if (
      event.type === "click" &&
      !controller.buttonLongPressed &&
      !controller.suppressNextButtonClick &&
      controller.previewEl &&
      this.isNoteBrowserWebMode(controller.previewEl)
    ) {
      // A retained NoteDraw webview button is the same NoteWeb wand as the
      // host-side proxy. Route both first/second clicks through one state
      // machine; calling NoteDraw's own activate helper here would only close
      // its controller while leaving NoteWeb's raw-edit marker and selector
      // alive, so a later reconciliation could immediately reopen it.
      void this.toggleNoteWebRawElementEditing(controller.previewEl);
      event.stopImmediatePropagation?.();
      return;
    }
    const method = event.type === "pointerdown"
      ? "onButtonPointerDown"
      : event.type === "pointerup" || event.type === "pointercancel" || event.type === "pointerleave"
      ? "onButtonPointerUp"
      : event.type === "touchend"
      ? "onButtonTouchEnd"
      : event.type === "contextmenu"
      ? "onButtonContextMenu"
      : event.type === "click"
      ? "onButtonClick"
      : null;
    if (!method) return;
    const handler = controller[method];
    if (typeof handler !== "function") return;
    if (event.type === "contextmenu") event.preventDefault();
    event.stopImmediatePropagation?.();
    void Promise.resolve(handler.call(controller, event));
  }

  isMobileWebviewerSurface(surface?: HTMLElement | null): boolean {
    if (!surface || !this.isNoteDrawSurfaceElement(surface)) return false;
    return Boolean(
      surface.closest(MWV_DEDUPE_ROOT_SELECTOR) ||
      surface.matches(MWV_DEDUPE_ROOT_SELECTOR) ||
      surface.querySelector(MWV_DEDUPE_ROOT_SELECTOR)
    );
  }

  findActiveNoteDrawShell(root?: HTMLElement): NoteDrawSurfaceElement | null {
    const scopes: HTMLElement[] = [];
    if (root) {
      scopes.push(root);
      const shell = root.closest<NoteDrawSurfaceElement>(".notedraw-shell");
      if (shell) scopes.push(shell);
    }

    for (const scope of scopes) {
      if (scope.isConnected && scope.matches(".notedraw-shell.is-drawing-active")) {
        return scope;
      }
      const shell = scope.querySelector<NoteDrawSurfaceElement>(".notedraw-shell.is-drawing-active");
      if (shell?.isConnected) return shell;
    }
    return null;
  }

  closeNoteDrawShell(shell?: HTMLElement | null): boolean {
    if (!shell) return false;
    const controller = (shell as NoteDrawSurfaceElement)._noteDrawController;
    if (controller) {
      controller.active = false;
      controller.button?.removeClass("is-active");
    }
    for (const cls of [
      "is-drawing-active",
      "is-palette-open",
      "is-text-panel-open",
      "is-selection-menu-open",
      "is-select-mode",
      "is-edit-md-mode",
      "is-watercolor-mode",
      "is-selecting-strokes",
      "is-moving-selection",
      "is-resizing-selection",
      "is-native-text-editing",
      "is-two-finger-scroll"
    ]) {
      shell.removeClass(cls);
    }
    shell
      .querySelectorAll<HTMLElement>(
        ".notedraw-header-button, .notedraw-webview-button, .notedraw-fallback-button, .notedraw-webview-inline-button, .notedraw-toolbar button, .notedraw-palette-panel button, .notedraw-text-panel button, .notedraw-selection-menu button"
      )
      .forEach((button) => button.removeClass("is-active"));
    return true;
  }

  forceCloseNoteDraw(root?: HTMLElement, onClose?: () => void): boolean {
    if (!root?.isConnected || !this.isNoteDrawSurfaceElement(root)) return false;
    const shell = this.findActiveNoteDrawShell(root);
    const controller = shell?._noteDrawController ?? this.findActiveNoteDrawController(root);
    const target = controller?.previewEl ?? shell;
    if (!shell && !this.isNoteDrawControllerActive(controller)) return false;

    if (controller?.active && typeof controller.toggle === "function") {
      try {
        void Promise.resolve(controller.toggle())
          .then(() => {
            controller.button?.removeClass("is-active");
            this.closeNoteDrawShell(controller.previewEl ?? shell);
          })
          .catch((error) => {
            console.error("[mobile-webviewer] NoteDraw close failed", error);
            this.closeNoteDrawShell(target);
          });
        onClose?.();
        return true;
      } catch (error) {
        console.error("[mobile-webviewer] NoteDraw close failed", error);
      }
    }

    const closed = this.closeNoteDrawShell(target);
    if (closed) onClose?.();
    return closed;
  }

  dispatchActivationClick(target: HTMLElement, restoreHidden = false): void {
    const wasHidden = target.hasClass("mwv-notedraw-source-button");
    const previousAriaHidden = target.getAttribute("aria-hidden");
    const previousTabIndex = target.getAttribute("tabindex");
    target.removeAttribute("aria-hidden");
    target.removeClass("mwv-notedraw-source-button");
    target.addClass("mwv-notedraw-activation-proxy");
    const rect = target.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const event = type.startsWith("pointer")
        ? new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: "mouse",
            clientX,
            clientY
          })
        : new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX,
            clientY
      });
      target.dispatchEvent(event);
    }
    window.setTimeout(() => {
      target.removeClass("mwv-notedraw-activation-proxy");
      if (target.isConnected && !target.hasClass("mwv-notedraw-launcher") && (restoreHidden || wasHidden)) {
        target.addClass("mwv-notedraw-source-button");
        if (previousAriaHidden === null) target.setAttribute("aria-hidden", "true");
        else target.setAttribute("aria-hidden", previousAriaHidden);
        if (previousTabIndex === null) target.tabIndex = -1;
        else target.setAttribute("tabindex", previousTabIndex);
      }
    }, 500);
  }

  triggerNoteDraw(root?: HTMLElement): void {
    if (root && (!root.isConnected || !this.isNoteDrawSurfaceElement(root))) return;
    const pluginRegistry = (this.app as App & {
      plugins?: { plugins?: Record<string, unknown> };
      commands?: {
        commands?: Record<string, { id?: string; name?: string }>;
        executeCommandById?: (id: string) => boolean;
      };
    });
    if (!pluginRegistry.plugins?.plugins?.notedraw) {
      new Notice(this.tr("noteDrawDisabled"));
      return;
    }

    root?.focus?.({ preventScroll: true });
    if (root?.isConnected) {
      this.refreshNoteDrawWorkspaceBinding(root, true, true);
      this.queueNoteDrawButtonDedupe(root);
    }
    window.setTimeout(() => {
      const queueDedupe = (forceEditMode = false) => {
        if (!root) return;
        window.setTimeout(() => this.queueNoteDrawButtonDedupe(root), 120);
        window.setTimeout(() => this.queueNoteDrawButtonDedupe(root), 500);
        this.queueNoteDrawControllerSync(root, forceEditMode);
      };
      const toggleController = (controller?: NoteDrawControllerLike | null): boolean => {
        if (typeof controller?.toggle !== "function") return false;
        const wasActive = this.isNoteDrawControllerActive(controller);
        try {
          void Promise.resolve(controller.toggle()).catch((error) => {
            console.error("[mobile-webviewer] NoteDraw controller toggle failed", error);
          }).then(() => {
            queueDedupe(!wasActive);
          });
          queueDedupe(!wasActive);
          return true;
        } catch (error) {
          console.error("[mobile-webviewer] NoteDraw controller toggle failed", error);
          return false;
        }
      };
      const clickController = (controller?: NoteDrawControllerLike | null): boolean => {
        if (typeof controller?.onButtonClick !== "function") return false;
        const wasActive = this.isNoteDrawControllerActive(controller);
        try {
          const event = new MouseEvent("click", { bubbles: true, cancelable: true });
          void Promise.resolve(controller.onButtonPointerDown?.(event)).catch((error) => {
            console.error("[mobile-webviewer] NoteDraw controller pointerdown failed", error);
          });
          void Promise.resolve(controller.onButtonPointerUp?.(event)).catch((error) => {
            console.error("[mobile-webviewer] NoteDraw controller pointerup failed", error);
          });
          void Promise.resolve(controller.onButtonClick(event)).catch((error) => {
            console.error("[mobile-webviewer] NoteDraw controller click failed", error);
          }).then(() => {
            queueDedupe(!wasActive);
          });
          queueDedupe(!wasActive);
          return true;
        } catch (error) {
          console.error("[mobile-webviewer] NoteDraw controller click failed", error);
          return false;
        }
      };
      const webviewController = this.findWebviewNoteDrawController(root, true);
      if (webviewController?.previewEl && this.activateNoteDrawWebviewController(webviewController, webviewController.previewEl)) {
        return;
      }
      if (toggleController(webviewController)) {
        return;
      }
      if (clickController(webviewController)) {
        return;
      }
      const activeController = this.findActiveNoteDrawController(root);
      if (activeController?.surfaceType === "webview" && this.isMobileWebviewerSurface(activeController.previewEl) && toggleController(activeController)) {
        return;
      }
      const button = this.findNoteDrawSourceButton(root);
      if (toggleController(button?._noteDrawController)) {
        return;
      }
      if (clickController(button?._noteDrawController)) {
        return;
      }
      // NoteWeb's reading presentation is hosted by the Markdown preview
      // controller (surfaceType=preview), not by a separate webview
      // controller. Prefer that controller so the wand always opens the
      // familiar NoteDraw editing toolbar after a Web -> Note switch.
      if (!this.isNoteBrowserWebMode(root)) {
        const previewController = this.findNoteDrawPreviewController(root, true);
        if (previewController) {
          if (this.isNoteDrawControllerActive(previewController)) {
            this.ensureNoteDrawControllerButtonAnchored(previewController);
            this.syncNoteDrawHeaderButtonState(root!, previewController);
            this.queueNoteDrawControllerSync(root, false);
            return;
          }
          if (this.activateNoteDrawControllerFromHeader(previewController, root!)) return;
        }
      }
      const noteDrawApi = (window as Window & { NoteDraw?: NoteDrawWindowApi }).NoteDraw;
      if (toggleController(noteDrawApi?.getActiveController?.())) {
        return;
      }
      if (clickController(noteDrawApi?.getActiveController?.())) {
        return;
      }
      if (button) {
        this.dispatchActivationClick(button);
        queueDedupe(true);
        return;
      }

      const commands = pluginRegistry.commands;
      const availableIds = Object.keys(commands?.commands ?? {}).filter((id) => id.startsWith("notedraw:"));
      const commandId =
        availableIds.find((id) => id === "notedraw:toggle-draw-mode") ??
        availableIds.find((id) => /toggle|draw/i.test(id)) ??
        "notedraw:toggle-draw-mode";
      if (commands?.executeCommandById?.(commandId)) {
        queueDedupe(true);
        return;
      }

      this.refreshNoteDrawWorkspaceBinding(root, true, true);
      window.setTimeout(() => {
        this.refreshNoteDrawWorkspaceBinding(root, true, false);
        const retryButton = this.findNoteDrawSourceButton(root);
        const retryController =
          this.findWebviewNoteDrawController(root, true) ??
          retryButton?._noteDrawController ??
          this.collectNoteDrawControllers(root).find((controller) => controller.surfaceType === "webview");
        if (toggleController(retryController) || clickController(retryController)) {
          return;
        }
        if (retryButton) {
          this.dispatchActivationClick(retryButton);
          queueDedupe(true);
          return;
        }
        void this.addConsole("warn", "NoteDraw controller not ready on this page", root?.dataset?.url ?? "");
      }, 180);
    }, 80);
  }

  async activateBrowserView(url?: string, newTab = false, tabId?: string): Promise<void> {
    let leaf = newTab ? undefined : this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(newTab ? "tab" : false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    const view = leaf.view;
    if (url && view instanceof MobileWebviewerView) {
      if (tabId) view.activeBrowserTabId = tabId;
      view.openUrl(url);
    }
  }

  async openNoteBrowser(input?: string, newTab = false): Promise<void> {
    const requestToken = ++this.noteBrowserOpenSeq;
    const rememberedUrl = this.settings.noteBrowserUrl || this.settings.homeUrl;
    // `obsidian://open` is a one-shot deep link. If it was left in persisted
    // state, the toolbar/ribbon button would reopen that Markdown file instead
    // of opening a normal web page. Explicit input still routes through
    // NoteWeb; only an implicit restore falls back to the home page.
    const staleInternalTarget = !input && (
      isLegacyObsidianFileUrl(rememberedUrl) ||
      Boolean(parseObsidianOpenLink(rememberedUrl))
    );
    const requestedUrl = input
      ? normalizeInput(input, this.settings.searchUrl)
      : staleInternalTarget
        ? this.settings.homeUrl
        : rememberedUrl;
    if (input || staleInternalTarget) {
      this.settings.noteBrowserUrl = requestedUrl;
      this.settings.noteBrowserBack = [];
      this.settings.noteBrowserForward = [];
      const tab = this.ensureBrowserTab(this.settings.activeBrowserTabId);
      tab.url = this.settings.noteBrowserUrl;
      tab.title = hostName(this.settings.noteBrowserUrl);
      tab.back = [];
      tab.forward = [];
      tab.time = Date.now();
      await this.saveSettings();
    }
    const file = await this.ensureWebviewerNote();
    const isLatestRequest = () => newTab || requestToken === this.noteBrowserOpenSeq;
    if (this.disposed || !isLatestRequest()) return;
    const leaf = this.app.workspace.getLeaf(newTab ? "tab" : false);
    this.noteBrowserOpenTokens.set(leaf, requestToken);
    const isCurrentOpen = () => !this.disposed && isLatestRequest() && this.noteBrowserOpenTokens.get(leaf) === requestToken;
    if (!isCurrentOpen()) return;
    await leaf.openFile(file);
    if (!isCurrentOpen()) return;
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    this.setNoteBrowserReadingMode(leaf);
    let boundToLeaf = false;
    for (const delay of [0, 80, 240, 600, 1200]) {
      window.setTimeout(() => {
        if (!isCurrentOpen()) return;
        if (boundToLeaf || !leaf.view?.containerEl?.isConnected) return;
        this.processWebviewerEmbeds(leaf.view.containerEl);
        if (!isCurrentOpen()) return;
        const embeds = Array.from(leaf.view.containerEl.querySelectorAll<HTMLElement>(".mwv-embed[data-url]"));
        const embed = embeds.find((candidate) => this.isVisibleNoteDrawSurface(candidate)) ?? embeds[0];
        if (!embed) return;
        boundToLeaf = true;
        if (!isCurrentOpen()) return;
        this.syncNoteBrowserNativeIdentity(embed, requestedUrl);
        if (isCurrentOpen() && embed.dataset.url !== requestedUrl) {
          void this.openUrlInEmbed(embed, requestedUrl, false);
        }
      }, delay);
    }
  }

  setNoteBrowserReadingMode(leaf: WorkspaceLeaf): void {
    const view = leaf.view as { setState?: (state: Record<string, unknown>, result?: unknown) => Promise<void>; getState?: () => Record<string, unknown> };
    const isStillNoteBrowser = () => {
      const file = (leaf.view as { file?: unknown } | undefined)?.file;
      return leaf.view === view && file instanceof TFile && file.path === WEBVIEW_NOTE_PATH;
    };
    const applyReadingMode = () => {
      if (!isStillNoteBrowser()) return;
      try {
        const state = view.getState?.() ?? {};
        if (state.mode === "preview" && state.source === false) return;
        void view.setState?.({ ...state, mode: "preview", source: false }, { history: false });
      } catch (error) {
        console.warn("[mobile-webviewer] note browser preview mode skipped", error);
      }
    };
    applyReadingMode();
    for (const delay of [80, 240, 600]) {
      window.setTimeout(() => {
        if (isStillNoteBrowser()) applyReadingMode();
      }, delay);
    }
  }

  cleanupNoteBrowserDocumentResidue(scope: HTMLElement = this.app.workspace.containerEl): void {
    const documents = scope.matches(".mwv-note-browser-document")
      ? [scope]
      : Array.from(scope.querySelectorAll<HTMLElement>(".mwv-note-browser-document"));
    for (const documentEl of documents) {
      const leaf = this.findWorkspaceLeafForElement(documentEl);
      const file = (leaf?.view as { file?: unknown } | undefined)?.file;
      if (file instanceof TFile && file.path === WEBVIEW_NOTE_PATH) continue;
      documentEl.removeClass("mwv-note-browser-document");
      documentEl.removeClass("mwv-notedraw-legacy-migrated");
      documentEl.querySelectorAll<HTMLElement>(".mwv-note-browser-redundant-title").forEach((title) => {
        title.removeClass("mwv-note-browser-redundant-title");
      });
    }
  }

  enforceNoteBrowserReadingMode(): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view as { file?: unknown; getState?: () => Record<string, unknown> };
      if (!(view.file instanceof TFile) || view.file.path !== WEBVIEW_NOTE_PATH) return;
      const state = view.getState?.() ?? {};
      if (state.mode !== "preview" || state.source !== false) this.setNoteBrowserReadingMode(leaf);
      // Mobile direct-open race: the Markdown post-processor can run while the
      // view is still in Live Preview, leaving the preview sizer empty (0x0
      // embed). Re-sweep the leaf after the mode switch so a missing embed is
      // restored and processed even when no further layout-change fires.
      for (const delay of [120, 400, 900]) {
        window.setTimeout(() => {
          const file = (leaf.view as { file?: unknown } | undefined)?.file;
          if (!(file instanceof TFile) || file.path !== WEBVIEW_NOTE_PATH) return;
          if (!leaf.view?.containerEl?.isConnected) return;
          this.processWebviewerEmbeds(leaf.view.containerEl);
        }, delay);
      }
    });
  }

  async ensureWebviewerNote(): Promise<TFile> {
    const content = [
      `<div class="mwv-embed mwv-bing-home" data-url="${this.escapeAttr(this.settings.homeUrl)}" data-mwv-browser-mode="note">`,
      "  <div class=\"mwv-bing-logo\">Bing</div>",
      "  <div class=\"mwv-bing-search\" role=\"search\">",
      `    <input class="mwv-bing-input" type="search" placeholder="${this.escapeAttr(this.tr("searchBing"))}" autocomplete="off" />`,
      "    <button class=\"mwv-bing-submit\" type=\"button\">→</button>",
      "  </div>",
      "  <div class=\"mwv-bing-results\"></div>",
      "</div>",
      ""
    ].join("\n");
    const existing = this.app.vault.getAbstractFileByPath(WEBVIEW_NOTE_PATH);
    if (existing instanceof TFile) {
      return existing;
    }
    return await this.app.vault.create(WEBVIEW_NOTE_PATH, content);
  }

  resolveObsidianOpenFile(link: ObsidianOpenLink): TFile | null {
    const currentVault = this.app.vault.getName().trim();
    if (link.vault && currentVault && link.vault.localeCompare(currentVault, undefined, { sensitivity: "accent" }) !== 0) return null;
    let path = normalizePath(link.file.replace(/^\/+/, "").trim());
    if (!path || path.includes("\0") || path.split("/").some((segment) => segment === "..")) return null;
    const candidates = path.toLowerCase().endsWith(".md") ? [path] : [path, `${path}.md`];
    for (const candidate of candidates) {
      const file = this.app.vault.getAbstractFileByPath(candidate);
      if (file instanceof TFile) return file;
    }
    return null;
  }

  async renderObsidianNoteEmbed(embed: HTMLElement, link: ObsidianOpenLink, url: string): Promise<void> {
    const renderToken = ++this.embedRenderSeq;
    this.embedRenderTokens.set(embed, renderToken);
    if (this.disposed || !embed.isConnected) return;
    this.disposeBrowserSurfacesIn(embed);
    const localEmbed = embed as LocalNoteEmbedElement;
    localEmbed._mwvMarkdownComponent?.unload();
    localEmbed._mwvMarkdownComponent = undefined;
    embed.empty();
    embed.addClass("mwv-embed");
    embed.addClass("mwv-note-embed");
    embed.removeClass("mwv-bing-home");
    embed.removeClass("mwv-utility-embed");
    embed.removeClass("is-web-front");
    embed.removeClass("is-split-front");
    embed.addClass("is-note-front");
    embed.dataset.mwvBrowserMode = "note";
    this.applyNoteBrowserWebIsolation(embed, false);
    embed.dataset.url = url;
    embed.setAttribute("data-url", url);

    const file = this.resolveObsidianOpenFile(link);
    const title = file?.basename || link.file.split("/").pop() || "Obsidian note";
    this.renderBrowserChrome(embed, url, title);
    const article = embed.createEl("article", { cls: "mwv-note-surface mwv-local-note-surface" });
    article.dataset.url = url;
    article.createEl("h1", { cls: "mwv-page-title", text: title });
    const content = article.createDiv({ cls: "mwv-local-note-content" });
    if (!file) {
      content.createDiv({ cls: "mwv-empty", text: `Note not found: ${link.file}` });
      this.notifyNoteDrawWebviewChanged(embed);
      return;
    }

    try {
      const markdown = await this.app.vault.read(file);
      if (this.disposed || !embed.isConnected || embed.dataset.url !== url || this.embedRenderTokens.get(embed) !== renderToken) return;
      const component = new Component();
      component.load();
      localEmbed._mwvMarkdownComponent = component;
      await MarkdownRenderer.renderMarkdown(markdown, content, file.path, component);
      const target = link.heading || link.block;
      if (target) {
        window.setTimeout(() => {
          if (!content.isConnected) return;
          const normalizedTarget = target.replace(/^#+\s*/, "").trim().toLowerCase();
          const heading = Array.from(content.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"))
            .find((candidate) => candidate.textContent?.trim().toLowerCase() === normalizedTarget);
          heading?.scrollIntoView({ block: "start" });
        }, 0);
      }
    } catch (error) {
      if (this.disposed || !embed.isConnected || embed.dataset.url !== url || this.embedRenderTokens.get(embed) !== renderToken) return;
      console.error("[mobile-webviewer] Obsidian note render failed", error);
      content.createDiv({ cls: "mwv-empty", text: error instanceof Error ? error.message : "Unable to render note" });
    }
    this.notifyNoteDrawWebviewChanged(embed);
  }

  escapeAttr(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  processWebviewerEmbeds(root: HTMLElement): void {
    if (!root?.isConnected) return;
    const ownerLeaf = this.findWorkspaceLeafForElement(root);
    if (!ownerLeaf) {
      if (root === this.app.workspace.containerEl) {
        this.app.workspace.iterateAllLeaves((leaf) => {
          if (this.isNoteBrowserLeaf(leaf)) this.processWebviewerEmbeds(leaf.view.containerEl);
        });
      }
      return;
    }
    if (!this.isNoteBrowserLeaf(ownerLeaf)) return;
    this.dedupeNoteBrowserEmbedRoots(root);
    this.restoreMissingNoteBrowserEmbed(root);
    this.dedupeNoteBrowserEmbedRoots(root);
    const embeds = Array.from(root.querySelectorAll<HTMLElement>(".mwv-embed[data-url]")).filter((embed) => {
      const sourceView = embed.closest<HTMLElement>(".markdown-source-view");
      return this.isNoteWebOwnedElement(embed) && (!sourceView || window.getComputedStyle(sourceView).display !== "none");
    });
    for (const embed of embeds) {
      this.prepareWebviewerDocumentLayout(embed);
      const hasCurrentRenderer =
        embed.dataset.mwvProcessed === this.processorSessionId &&
        (embed.dataset.mwvRendering === this.processorSessionId || Boolean(embed.querySelector(":scope > .mwv-browser-chrome")));
      if (hasCurrentRenderer) continue;
      this.processorSeq += 1;
      embed.dataset.mwvProcessed = this.processorSessionId;
      embed.dataset.mwvRendering = this.processorSessionId;
      embed.dataset.mwvBack = JSON.stringify(this.settings.noteBrowserBack ?? []);
      embed.dataset.mwvForward = JSON.stringify(this.settings.noteBrowserForward ?? []);
      // The mode belongs to this NoteWeb surface, not to the global setting.
      // Markdown post-processing runs again after NoteDraw mounts/remounts;
      // re-reading the global default here used to undo a Web -> Note wand
      // click (especially when another NoteWeb leaf had last selected Web).
      // Only initialize a missing/invalid marker from the setting.
      const currentMode = embed.dataset.mwvBrowserMode;
      if (currentMode !== "note" && currentMode !== "web" && currentMode !== "split") {
        embed.dataset.mwvBrowserMode = this.settings.browserFrontendMode === "web"
          ? "web"
          : this.settings.browserFrontendMode === "split"
            ? "split"
            : "note";
      }
      const tab = this.ensureBrowserTab(this.settings.activeBrowserTabId);
      embed.dataset.mwvActiveTabId = tab.id;
      const url = this.settings.noteBrowserUrl || embed.dataset.url || this.settings.homeUrl;
      embed.dataset.url = url;
      void this.renderEmbed(embed, url)
        .catch((error) => {
          console.error("[mobile-webviewer] NoteWeb render failed", error);
        })
        .finally(() => {
          if (embed.dataset.mwvRendering === this.processorSessionId) delete embed.dataset.mwvRendering;
        });
    }
  }

  dedupeNoteBrowserEmbedRoots(root: HTMLElement): void {
    if (!root?.isConnected || !this.isNoteWebOwnedElement(root)) return;
    const hosts = root.matches(".el-div")
      ? [root]
      : Array.from(root.querySelectorAll<HTMLElement>(".mwv-note-browser-document .el-div"));
    for (const host of hosts) {
      const embeds = Array.from(host.children).filter((element): element is HTMLElement => {
        return isHtmlElement(element) && element.matches(".mwv-embed[data-url]");
      });
      if (embeds.length < 2) continue;
      const winner = embeds.find((embed) => {
        const controller = (embed as NoteDrawSurfaceElement)._noteDrawController;
        return Boolean(controller?.previewEl === embed && controller.canvas?.isConnected);
      }) ?? embeds.find((embed) => embed.dataset.mwvRecovered === "true") ?? embeds[0];
      for (const embed of embeds) {
        if (embed === winner) continue;
        const controller = (embed as NoteDrawSurfaceElement)._noteDrawController;
        if (controller) {
          void this.resetNoteDrawWebviewControllers(embed).finally(() => embed.remove());
        } else {
          embed.remove();
        }
      }
    }
  }

  restoreMissingNoteBrowserEmbed(root: HTMLElement): void {
    if (!root?.isConnected || !this.isNoteWebOwnedElement(root)) return;
    const previews = root.matches(".markdown-preview-view")
      ? [root]
      : Array.from(root.querySelectorAll<HTMLElement>(".markdown-preview-view"));
    for (const preview of previews) {
      if (preview.querySelector(".mwv-embed[data-url]")) continue;
      const leaf = this.findWorkspaceLeafForElement(preview);
      const file = (leaf?.view as { file?: unknown } | undefined)?.file;
      if (!(file instanceof TFile) || file.path !== WEBVIEW_NOTE_PATH) continue;
      const sizer = preview.querySelector<HTMLElement>(".markdown-preview-sizer");
      if (!sizer) continue;
      let host = Array.from(sizer.children).find((element) => {
        return isHtmlElement(element) && element.hasClass("el-div") && !element.textContent?.trim();
      });
      if (!isHtmlElement(host)) {
        host = sizer.createDiv({ cls: "el-div" });
        const footer = sizer.querySelector<HTMLElement>(":scope > .mod-footer");
        if (footer) sizer.insertBefore(host, footer);
      }
      const embed = host.createDiv({ cls: "mwv-embed mwv-bing-home" });
      embed.dataset.mwvRecovered = "true";
      const url = this.settings.noteBrowserUrl || this.settings.homeUrl;
      embed.dataset.url = url;
      const currentMode = embed.dataset.mwvBrowserMode;
      if (currentMode !== "note" && currentMode !== "web" && currentMode !== "split") {
        embed.dataset.mwvBrowserMode = this.settings.browserFrontendMode === "web"
          ? "web"
          : this.settings.browserFrontendMode === "split"
            ? "split"
            : "note";
      }
      embed.setAttribute("data-url", url);
    }
  }

  prepareWebviewerDocumentLayout(embed: HTMLElement): void {
    if (!embed?.isConnected || !this.isNoteWebOwnedElement(embed)) return;
    const preview =
      embed.closest<HTMLElement>(".markdown-preview-view, .markdown-rendered") ??
      embed.closest<HTMLElement>(".markdown-preview-sizer")?.parentElement;
    if (!preview) return;
    preview.addClass("mwv-note-browser-document");
    preview.toggleClass(
      "mwv-notedraw-legacy-migrated",
      this.settings.noteDrawLegacyWebviewerMigrationVersion >= NOTEDRAW_LEGACY_WEBVIEWER_MIGRATION_VERSION
    );
    preview.querySelectorAll<HTMLElement>("h1, .inline-title").forEach((title) => {
      if (title.textContent?.trim().toLowerCase() === "mobile webviewer") {
        title.addClass("mwv-note-browser-redundant-title");
      }
    });
    this.syncNoteBrowserNativeIdentity(embed, embed.dataset.url || this.settings.noteBrowserUrl || this.settings.homeUrl);
    this.queueLegacyNoteDrawWebviewerMigration(preview);
  }

  syncNoteBrowserNativeIdentity(embed: HTMLElement, url: string): void {
    if (!url) return;
    const leafContent = embed.closest<HTMLElement>(".workspace-leaf-content");
    if (!leafContent) return;
    const leaf = this.findWorkspaceLeafForElement(leafContent);
    if (!leaf) return;
    const file = (leaf?.view as { file?: unknown } | undefined)?.file;
    if (!(file instanceof TFile) || file.path !== WEBVIEW_NOTE_PATH) return;
    const leafEl = leafContent.closest<HTMLElement>(".workspace-leaf") ?? leafContent;
    const tabTitle = (leaf as WorkspaceLeaf & { tabHeaderInnerTitleEl?: HTMLElement }).tabHeaderInnerTitleEl;
    const titles = [
      ...Array.from(leafEl.querySelectorAll<HTMLElement>(".view-header-title")),
      ...(tabTitle ? [tabTitle] : [])
    ];
    for (const title of titles) {
      title.setText(url);
      title.setAttribute("title", url);
      title.addClass("mwv-note-browser-native-title");
    }
    this.syncNoteBrowserNativeActions(leaf, embed);
  }

  getNoteBrowserEmbed(leaf: WorkspaceLeaf): HTMLElement | null {
    const root = leaf.view?.containerEl;
    if (!root) return null;
    return root.querySelector<HTMLElement>(
      ".mwv-note-browser-document .mwv-embed.mwv-bing-home, .mwv-note-browser-document .mwv-embed.mwv-note-embed, .mwv-note-browser-document .mwv-embed.mwv-utility-embed"
    );
  }

  syncNoteBrowserNativeActions(leaf: WorkspaceLeaf, embed: HTMLElement): void {
    const view = leaf.view as unknown as {
      addAction?: (icon: IconName, title: string, callback: (evt: MouseEvent) => any) => HTMLElement;
      onPaneMenu?: (menu: Menu, source: string) => any;
      getState?: () => Record<string, unknown>;
      setState?: (state: Record<string, unknown>, result?: unknown) => Promise<void>;
    };
    if (!view) return;

    let binding = this.noteBrowserNativeBindings.get(leaf);
    if (!binding) {
      const originalPaneMenu = view.onPaneMenu;
      const originalSetState = view.setState;
      const navButtons: NoteBrowserNativeBinding["navButtons"] = [];
      binding = { leaf, view, navButtons, hiddenEditButtons: [], originalPaneMenu, originalSetState };
      this.noteBrowserNativeBindings.set(leaf, binding);
      this.noteBrowserNativeBindingRecords.add(binding);
      if (originalSetState) {
        const guardedSetState = (state: Record<string, unknown>, result?: unknown) => {
          const file = (leaf.view as { file?: unknown } | undefined)?.file;
          const protectsNoteBrowser = file instanceof TFile && file.path === WEBVIEW_NOTE_PATH;
          const nextState = protectsNoteBrowser && (state.mode === "source" || state.source === true)
            ? { ...state, mode: "preview", source: false }
            : state;
          return originalSetState.call(view, nextState, result);
        };
        binding.guardedSetState = guardedSetState;
        view.setState = guardedSetState;
      }
      const findEmbed = () => {
        const live = this.getNoteBrowserEmbed(leaf);
        if (live) return live;
        if (embed.isConnected) return embed;
        // The bound embed can be replaced by recovery/dedupe passes. Fall
        // back to any connected NoteWeb embed in this leaf so menu entries
        // never act on a detached (invisible) element.
        const fallback = leaf.view?.containerEl?.querySelector<HTMLElement>(".mwv-embed[data-url]");
        return fallback ?? null;
      };
      const addMenuItem = (menu: Menu, title: string, icon: IconName, callback: () => void, checked?: boolean) => {
        menu.addItem((item) => {
          item.setTitle(title).setIcon(icon).onClick(() => callback());
          if (checked !== undefined) item.setChecked(checked);
        });
      };
      const guardedPaneMenu = (menu: Menu, source: string) => {
        originalPaneMenu?.call(view, menu, source);
        const current = findEmbed();
        if (!current) return;
        menu.addSeparator();
        const mode = current.dataset.mwvBrowserMode || "note";
        addMenuItem(menu, this.tr("note"), "file-text", () => this.setNoteBrowserEmbedMode(current, "note"), mode === "note");
        addMenuItem(menu, this.tr("web"), "globe-2", () => this.setNoteBrowserEmbedMode(current, "web"), mode === "web");
        addMenuItem(menu, "Split", "columns-2", () => this.setNoteBrowserEmbedMode(current, "split"), mode === "split");
        addMenuItem(menu, this.tr("reload"), "rotate-cw", () => void this.refreshEmbed(current));
        addMenuItem(menu, this.tr("home"), "home", () => void this.openUrlInEmbed(current, this.settings.homeUrl));
        addMenuItem(menu, this.tr("saveMd"), "file-down", () => void this.exportEmbedWebNote(current));
        addMenuItem(menu, this.tr("more"), "more-horizontal", () => {
          const url = current.dataset.url || this.settings.homeUrl;
          const title = current.dataset.mwvCurrentTitle || "";
          let chrome = current.querySelector<HTMLElement>(":scope > .mwv-browser-chrome");
          if (!chrome) {
            // Recovered or fast-reloaded embeds can miss their chrome. Rebuild
            // it instead of silently ignoring the More entry.
            this.renderBrowserChrome(current, url, title || hostName(url));
            chrome = current.querySelector<HTMLElement>(":scope > .mwv-browser-chrome");
          }
          if (chrome) this.toggleMorePanel(current, chrome, url, title);
        });
      };
      binding.guardedPaneMenu = guardedPaneMenu;
      view.onPaneMenu = guardedPaneMenu;
      if (typeof view.addAction === "function") {
        const modeAction = view.addAction("file-text", this.tr("note"), () => undefined);
        modeAction.addClass("mwv-note-browser-mode-action");
        // Obsidian's Markdown view listens for toolbar clicks as well. Keep
        // this replacement action local to NoteWeb while allowing the action
        // callback itself to run on the target element.
        modeAction.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const current = findEmbed();
          if (!current) return;
          this.setNoteBrowserEmbedMode(current, current.dataset.mwvBrowserMode === "web" ? "note" : "web");
        });
        binding.modeAction = modeAction;
        const actionHost = (leaf.view.containerEl?.closest<HTMLElement>(".workspace-leaf") ?? leaf.view.containerEl)
          ?.querySelector<HTMLElement>(".view-actions");
        const moreAction = actionHost?.querySelector<HTMLElement>(
          ".view-action.mod-more, [aria-label*='More' i], [aria-label*='更多'], [title*='More' i], [title*='更多']"
        );
        if (moreAction && modeAction.parentElement && moreAction.parentElement === modeAction.parentElement) {
          modeAction.parentElement.insertBefore(modeAction, moreAction);
        }
      }
    }

    this.bindNoteBrowserNativeNav(leaf, binding, embed);
    this.hideNoteBrowserEditActions(leaf, binding);

    const back = this.canNavigateEmbed(embed, "back");
    const forward = this.canNavigateEmbed(embed, "forward");
    const setNavState = (entry: NoteBrowserNativeBinding["navButtons"][number] | undefined, enabled: boolean) => {
      if (!entry) return;
      entry.element.toggleClass("is-disabled", !enabled);
      entry.element.setAttribute("aria-disabled", String(!enabled));
      (entry.element as HTMLButtonElement).disabled = !enabled;
    };
    setNavState(binding.navButtons.find((entry) => entry.direction === "back" && entry.element.isConnected), back);
    setNavState(binding.navButtons.find((entry) => entry.direction === "forward" && entry.element.isConnected), forward);
    if (binding.modeAction) {
      const mode = embed.dataset.mwvBrowserMode === "web" ? "web" : "note";
      setIcon(binding.modeAction, mode === "web" ? "globe-2" : "file-text");
      const label = mode === "web" ? this.tr("note") : this.tr("web");
      binding.modeAction.setAttribute("aria-label", label);
      binding.modeAction.setAttribute("title", label);
    }
  }

  hideNoteBrowserEditActions(leaf: WorkspaceLeaf, binding: NoteBrowserNativeBinding): void {
    const root = leaf.view?.containerEl?.closest<HTMLElement>(".workspace-leaf") ?? leaf.view?.containerEl;
    const actions = root?.querySelector<HTMLElement>(".view-actions");
    if (!actions) return;
    const candidates = Array.from(actions.querySelectorAll<HTMLElement>(".view-action, button, [role='button']"));
    for (const button of candidates) {
      if (button === binding.modeAction || binding.hiddenEditButtons.includes(button)) continue;
      const marker = `${button.getAttribute("aria-label") ?? ""} ${button.getAttribute("title") ?? ""} ${button.dataset.tooltip ?? ""}`.toLowerCase();
      const isToggle = button.hasClass("mod-toggle-edit") || /edit this file|toggle reading view|编辑(?:当前)?文件|切换阅读视图|阅读视图|编辑视图/.test(marker);
      if (!isToggle) continue;
      button.addClass("mwv-note-browser-replaced-edit-action");
      binding.hiddenEditButtons.push(button);
    }
  }

  bindNoteBrowserNativeNav(leaf: WorkspaceLeaf, binding: NoteBrowserNativeBinding, embed: HTMLElement): void {
    const navContainer = (leaf.view.containerEl?.closest<HTMLElement>(".workspace-leaf") ?? leaf.view.containerEl)
      ?.querySelector<HTMLElement>(":scope > .view-header .view-header-nav-buttons, .view-header-nav-buttons");
    if (!navContainer) return;
    const nativeButtons = Array.from(navContainer.querySelectorAll<HTMLElement>(".nav-action-button, button"))
      .filter((button) => button.isConnected)
      .slice(0, 2);
    const expected = new Set(nativeButtons);
    for (const entry of [...binding.navButtons]) {
      if (expected.has(entry.element) && entry.element.isConnected) continue;
      entry.element.removeEventListener("click", entry.handler, true);
      entry.element.removeClass("mwv-note-browser-native-nav");
      binding.navButtons.splice(binding.navButtons.indexOf(entry), 1);
    }
    const findEmbed = () => {
      const live = this.getNoteBrowserEmbed(leaf);
      if (live) return live;
      if (embed.isConnected) return embed;
      return leaf.view?.containerEl?.querySelector<HTMLElement>(".mwv-embed[data-url]") ?? null;
    };
    (["back", "forward"] as const).forEach((direction, index) => {
      const element = nativeButtons[index];
      if (!element || binding.navButtons.some((entry) => entry.element === element)) return;
      const handler = (event: Event) => {
        const current = findEmbed();
        if (!current) return;
        const key = direction === "back" ? "mwvBack" : "mwvForward";
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        if (!this.canNavigateEmbed(current, direction)) return;
        if (direction === "back") void this.navigateEmbedBack(current);
        else void this.navigateEmbedForward(current);
      };
      element.addEventListener("click", handler, true);
      element.addClass("mwv-note-browser-native-nav");
      binding.navButtons.push({ element, direction, handler, originalDisabled: (element as HTMLButtonElement).disabled === true });
    });
  }

  setNoteBrowserEmbedMode(embed: HTMLElement, mode: "note" | "web" | "split"): void {
    // Note and Web are two presentations of the same page. Keep the live
    // surface mounted so its document, history, session state, and URL survive
    // every mode switch.
    const retainedSurface = embed.querySelector<BrowserSurfaceElement>(
      ":scope > .mwv-live-browser > .mwv-live-frame"
    );
    if (mode !== "web" && this.isNoteBrowserRawEditingMode(embed)) {
      void this.leaveNoteWebRawElementEditing(embed);
    }
    // Invalidate any delayed NoteDraw remounts from the previous transition.
    this.noteDrawControllerRestoreTokens.set(embed, ++this.noteDrawControllerRestoreSeq);
    embed.dataset.mwvBrowserMode = mode;
    this.settings.browserFrontendMode = mode === "web" ? "web" : "note";
    void this.saveSettings();
    embed.toggleClass("is-web-front", mode === "web");
    embed.toggleClass("is-split-front", mode === "split");
    this.applyBrowserRuntimeClasses(embed);
    this.applyNoteBrowserWebIsolation(embed, mode === "web" && !this.isNoteBrowserRawEditingMode(embed));
    const leafContent = embed.closest<HTMLElement>(".workspace-leaf-content") ?? embed;
    if (mode === "web") {
      if (this.isNoteBrowserRawEditingMode(embed)) {
        // The element editor is the explicit exception to raw isolation. Keep
        // this page's NoteDraw controller alive and reconcile only this leaf.
        this.refreshNoteDrawWorkspaceBinding(embed, true, false);
        this.queueNoteDrawControllerSync(embed, true);
      } else {
        // Web mode owns the viewport and must not leave an active NoteDraw
        // shell, header proxy, or stale toolbar mounted over the guest page.
        this.disposeNoteDrawControllersForRawSurface(embed);
        this.disposeAllRawNoteDrawControllers();
        this.cleanupStaleNoteDrawButtonResidue(leafContent);
        this.hideNoteDrawHeaderButtonsForWebviewerLeaf(embed);
      }
      this.ensureNoteWebWandProxy(embed);
    } else {
      // Reconcile immediately when returning to Note/Split mode so buttons
      // hidden for Web mode are restored and the current controller is the
      // only toolbar that survives the mode switch.
      this.removeNoteWebWandProxy(embed);
      this.cleanupStaleNoteDrawButtonResidue(leafContent);
      this.prepareWebviewerDocumentLayout(embed);
      this.refreshNoteDrawWorkspaceBinding(embed, true, false);
      this.queueNoteDrawButtonDedupe(embed);
      this.queueNoteDrawControllerSync(embed, true);
      this.queueNoteDrawControllerRestore(embed);
    }
    embed.querySelectorAll<HTMLElement>("[data-mwv-embed-mode]").forEach((button) => {
      button.toggleClass("is-active", button.dataset.mwvEmbedMode === mode);
    });
    if ((mode === "web" || mode === "split") && !embed.querySelector(":scope > .mwv-live-browser")) {
      const liveUrl = embed.dataset.url || this.settings.homeUrl;
      if (/^https?:\/\//i.test(liveUrl)) this.renderLiveBrowserSurface(embed, liveUrl);
    }
    if (retainedSurface && retainedSurface.isConnected) {
      const currentSurface = embed.querySelector<BrowserSurfaceElement>(
        ":scope > .mwv-live-browser > .mwv-live-frame"
      );
      if (currentSurface !== retainedSurface) {
        console.error("[mobile-webviewer] Note/Web mode switch replaced the live page unexpectedly");
      }
    }
    this.syncNoteBrowserNativeIdentity(embed, embed.dataset.url || this.settings.homeUrl);
  }

  canNavigateEmbed(embed: HTMLElement, direction: "back" | "forward"): boolean {
    const surface = embed.querySelector<BrowserSurfaceElement>(":scope > .mwv-live-browser > .mwv-live-frame");
    if (this.isElectronWebview(surface)) {
      try {
        if (!this.isBrowserSurfaceReady(surface)) return false;
        if (direction === "back" && surface.canGoBack?.()) return true;
        if (direction === "forward" && surface.canGoForward?.()) return true;
      } catch {
        // The guest may be tearing down while the host view is rebuilding.
      }
    }
    return this.getEmbedStack(embed, direction === "back" ? "mwvBack" : "mwvForward").length > 0;
  }

  handleExternalLinkClick(event: MouseEvent): void {
    if (event.defaultPrevented) return;
    if (event.type === "click" && event.button !== 0) return;
    if (event.type === "auxclick" && event.button !== 1) return;

    const anchor = event.composedPath().find(isAnchorElement);
    if (!anchor || anchor.hasAttribute("download")) return;
    const rawHref = anchor.getAttribute("href")?.trim() ?? "";

    // Explicit Obsidian open links are routed through NoteWeb, but links
    // already rendered inside NoteWeb remain owned by its local navigation.
    if (parseObsidianOpenLink(rawHref)) {
      if (anchor.closest(".mwv-root, .mwv-embed, .mwv-note-browser-document")) return;
      const leaf = this.findWorkspaceLeafForElement(anchor);
      const view = leaf?.view as { file?: unknown; getViewType?: () => string } | undefined;
      const file = view?.file;
      const link = parseObsidianOpenLink(rawHref);
      if (!link || !leaf || view?.getViewType?.() !== "markdown" || !(file instanceof TFile) || file.extension !== "md" || file.path === WEBVIEW_NOTE_PATH) return;
      const currentVault = this.app.vault.getName().trim();
      if (link.vault && currentVault && link.vault.localeCompare(currentVault, undefined, { sensitivity: "accent" }) !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      runAsync(() => this.openNoteBrowser(rawHref, true));
      return;
    }

    // Obsidian internal links may expose a browser-resolved absolute href.
    // Keep them (and attachment/protocol links) on Obsidian's native router.
    if (anchor.classList.contains("internal-link") || anchor.hasAttribute("data-href")) return;
    if (isLegacyObsidianFileUrl(rawHref)) return;
    if (!/^https?:\/\//i.test(rawHref)) return;
    const url = anchor.href.trim();
    if (!/^https?:\/\//i.test(url)) return;

    // NoteWeb and the standalone browser own their navigation. This hook is
    // only for external links rendered by ordinary Markdown notes.
    if (anchor.closest(".mwv-root, .mwv-embed, .mwv-note-browser-document")) return;
    const leaf = this.findWorkspaceLeafForElement(anchor);
    const view = leaf?.view as { file?: unknown; getViewType?: () => string } | undefined;
    const file = view?.file;
    if (!leaf || view?.getViewType?.() !== "markdown" || !(file instanceof TFile) || file.extension !== "md" || file.path === WEBVIEW_NOTE_PATH) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    runAsync(() => this.openNoteBrowser(url, true));
  }

  async handleGlobalBingEvent(event: Event): Promise<void> {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const embed = target.closest<HTMLElement>(".mwv-embed.mwv-bing-home, .mwv-embed.mwv-note-embed");
    if (embed && !this.isNoteWebOwnedElement(embed)) return;
    const copyTarget =
      event.type === "click"
        ? target.closest<HTMLElement>("[data-mwv-copy-url]")
        : null;

    if (copyTarget) {
      const url = copyTarget.dataset.mwvCopyUrl ?? "";
      const title = copyTarget.dataset.mwvCopyTitle ?? url;
      if (!url) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      await navigator.clipboard.writeText(`[${title}](${url})`);
      new Notice(this.tr("copiedLink"));
      return;
    }

    const openTarget =
      event.type === "click" || event.type === "auxclick"
        ? target.closest<HTMLElement>("[data-mwv-open-url], .mwv-bing-shortcuts a[href]")
        : null;

    if (embed && openTarget) {
      const url =
        openTarget.dataset.mwvOpenUrl ??
        (isAnchorElement(openTarget) ? openTarget.href : "");
      if (!url) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const mouseEvent = event as MouseEvent;
      const openInObsidianTab = (event.type === "auxclick" && mouseEvent.button === 1)
        || mouseEvent.ctrlKey
        || mouseEvent.metaKey
        || mouseEvent.shiftKey;
      if (openInObsidianTab) {
        await this.openNoteBrowser(url, true);
      } else {
        await this.openUrlInEmbed(embed, url);
      }
      return;
    }

    const isClickSubmit =
      event.type === "click" &&
      Boolean(target.closest?.(".mwv-bing-submit"));
    const isEnterInput =
      event.type === "keydown" &&
      (event as KeyboardEvent).key === "Enter" &&
      Boolean(target.closest?.(".mwv-bing-input"));

    if (!isClickSubmit && !isEnterInput) return;

    const input = embed?.querySelector<HTMLInputElement>(".mwv-bing-input");
    const resultHost =
      embed?.querySelector<HTMLElement>(".mwv-bing-results") ??
      embed?.createDiv({ cls: "mwv-bing-results" });
    if (!embed || !input || !resultHost) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    await this.runBingHomeSearch(embed, input, resultHost);
  }

  async runBingHomeSearch(embed: HTMLElement, input: HTMLInputElement, resultHost: HTMLElement): Promise<void> {
    const query = input.value.trim();
    if (!query) return;
    const searchUrl = DEFAULT_SEARCH.replace("{{query}}", encodeURIComponent(query));
    this.pushEmbedHistory(embed, searchUrl);
    resultHost.empty();
    resultHost.createDiv({ cls: "mwv-bing-status", text: this.tr("searching") });

    try {
      const results = await this.searchBing(query);
      resultHost.empty();
      this.renderBingResults(resultHost, query, results);
    } catch (error) {
      console.error("[mobile-webviewer] Bing home search failed", error);
      resultHost.empty();
      this.renderBingResults(resultHost, query, fallbackSearchResults(query));
    }
  }

  renderBingResults(resultHost: HTMLElement, query: string, results: SearchResult[]): void {
    resultHost.empty();
    resultHost.createDiv({ cls: "mwv-bing-count", text: `约 ${Math.max(results.length * 61500, 492000).toLocaleString()} 个结果` });

    const shell = resultHost.createDiv({ cls: "mwv-bing-serp" });
    const main = shell.createDiv({ cls: "mwv-bing-main" });

    for (const result of results) {
      this.renderSearchResult(main, result);
    }

    if (query.trim() && results.length < 80) {
      const more = main.createEl("button", {
        cls: "mwv-more-results",
        text: this.tr("moreResults"),
        attr: { type: "button" }
      });
      more.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        runAsync(async () => {
          more.disabled = true;
          more.setText(this.tr("loading"));
          const nextMax = Math.min(80, Math.max(results.length + BING_DEFAULT_MAX_RESULTS, BING_DEFAULT_MAX_RESULTS * 2));
          const nextPages = Math.ceil(nextMax / BING_RESULTS_PER_PAGE);
          try {
            const expanded = await this.searchBing(query, nextPages, nextMax);
            this.renderBingResults(resultHost, query, expanded);
          } catch (error) {
            console.error("[mobile-webviewer] Bing more results failed", error);
            more.disabled = false;
            more.setText(this.tr("loadFailedRetry"));
          }
        });
      });
    }

  }

  renderSearchResult(parent: HTMLElement, result: SearchResult): void {
    const item = parent.createDiv({ cls: "mwv-bing-result" });
    const source = item.createDiv({ cls: "mwv-result-source" });
    source.createSpan({ cls: "mwv-result-favicon", text: hostName(result.url).slice(0, 1).toUpperCase() });
    const sourceText = source.createDiv({ cls: "mwv-result-source-text" });
    sourceText.createDiv({ cls: "mwv-result-host", text: hostName(result.url) });
    const actions = source.createDiv({ cls: "mwv-result-actions" });
    const open = actions.createEl("button", { cls: "mwv-result-action", attr: { type: "button", "data-mwv-open-url": result.url, title: "Open" } });
    setIcon(open, "arrow-right");
    const copy = actions.createEl("button", { cls: "mwv-result-action", attr: { type: "button", "data-mwv-copy-url": result.url, "data-mwv-copy-title": result.title, title: "Copy link" } });
    setIcon(copy, "copy");
    const titleLine = item.createDiv({ cls: "mwv-result-title-line" });
    const titleLink = titleLine.createEl("a", {
      cls: "mwv-bing-result-title",
      text: result.title,
      href: result.url,
      attr: { "data-mwv-open-url": result.url, title: result.url }
    });
    titleLink.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const embed = parent.closest<HTMLElement>(".mwv-embed[data-url]");
      if (embed && this.isNoteWebOwnedElement(embed)) void this.openUrlInEmbed(embed, result.url);
    }, true);
    item.createDiv({ cls: "mwv-bing-result-url", text: result.url });
    const body = item.createDiv({ cls: "mwv-result-body" });
    if (result.imageUrl) {
      body.createEl("img", { cls: "mwv-result-thumb", attr: { src: result.imageUrl, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" } });
    }
    if (result.snippet) body.createDiv({ cls: "mwv-bing-result-snippet", text: result.snippet });
  }

  getEmbedStack(embed: HTMLElement, key: "mwvBack" | "mwvForward"): string[] {
    return parseJsonStringArray(embed.dataset[key]);
  }

  setEmbedStack(embed: HTMLElement, key: "mwvBack" | "mwvForward", stack: string[]): void {
    embed.dataset[key] = JSON.stringify(stack.slice(-40));
  }

  pushEmbedHistory(embed: HTMLElement, nextUrl: string): void {
    const currentUrl = embed.dataset.url;
    if (currentUrl && !equivalentEmbedUrl(currentUrl, nextUrl)) {
      const back = this.getEmbedStack(embed, "mwvBack");
      if (back[back.length - 1] !== currentUrl) back.push(currentUrl);
      this.setEmbedStack(embed, "mwvBack", back);
      this.setEmbedStack(embed, "mwvForward", []);
    }
    embed.dataset.url = nextUrl;
    embed.setAttribute("data-url", nextUrl);
    embed.dataset.mwvProgrammaticUrl = nextUrl;
    void this.persistEmbedState(embed);
  }

  async openUrlInEmbed(embed: HTMLElement, url: string, recordHistory = true): Promise<void> {
    const requestToken = ++this.embedRenderSeq;
    this.embedRenderTokens.set(embed, requestToken);
    if (this.disposed || !embed.isConnected) return;
    const nextUrl = normalizeInput(url, this.settings.searchUrl);
    const previousUrl = embed.dataset.url;
    await this.flushEmbedReaderNow(embed);
    if (this.disposed || !embed.isConnected || this.embedRenderTokens.get(embed) !== requestToken) return;
    if (previousUrl && !equivalentEmbedUrl(previousUrl, nextUrl)) {
      await this.resetNoteDrawWebviewControllers(embed);
      if (this.disposed || !embed.isConnected || this.embedRenderTokens.get(embed) !== requestToken) return;
    }
    if (recordHistory) {
      this.pushEmbedHistory(embed, nextUrl);
    } else {
      embed.dataset.url = nextUrl;
      embed.dataset.mwvProgrammaticUrl = nextUrl;
      embed.setAttribute("data-url", nextUrl);
      void this.persistEmbedState(embed);
    }
    const obsidianLink = parseObsidianOpenLink(nextUrl);
    if (obsidianLink) {
      await this.renderObsidianNoteEmbed(embed, obsidianLink, nextUrl);
      const file = this.resolveObsidianOpenFile(obsidianLink);
      await this.syncEmbedActiveTab(embed, nextUrl, file?.basename || obsidianLink.file);
      return;
    }
    const liveSurface = embed.querySelector<BrowserSurfaceElement>(":scope > .mwv-live-browser > .mwv-live-frame");
    if (embed.hasClass("is-web-front") && liveSurface && /^https?:\/\//i.test(nextUrl)) {
      // Raw Web mode navigates the already-mounted guest page. Do not render
      // a second reader/search document or replace the WebView while the user
      // is switching between the two presentations.
      this.updateEmbedChrome(embed, nextUrl, hostName(nextUrl));
      if (!this.sameWebPage(this.safeBrowserSurfaceUrl(liveSurface), nextUrl)) {
        this.setBrowserSurfaceUrl(liveSurface, nextUrl);
      }
      void this.addHistory({ title: hostName(nextUrl), url: nextUrl, time: Date.now() });
      await this.syncEmbedActiveTab(embed, nextUrl, hostName(nextUrl));
      return;
    }
    const utilityKind = internalUtilityKind(nextUrl);
    if (utilityKind) {
      this.renderUtilityEmbed(embed, utilityKind, nextUrl);
      await this.syncEmbedActiveTab(embed, nextUrl, utilityPageTitle(utilityKind));
      return;
    }
    const query = this.extractBingQuery(nextUrl);
    if (this.isBingHome(nextUrl) || query !== null) {
      await this.renderBingShellEmbed(embed, query ?? "");
      void this.addHistory({
        title: query ? `Bing: ${query}` : "Bing",
        url: nextUrl,
        time: Date.now()
      });
      void this.syncEmbedActiveTab(embed, nextUrl, query ? `Bing: ${query}` : "Bing");
      return;
    }
    void this.addHistory({
      title: hostName(nextUrl),
      url: nextUrl,
      time: Date.now()
    });
    try {
      await this.renderEmbed(embed, nextUrl);
    } catch (error) {
      console.error("[mobile-webviewer] render embed failed", error);
      void this.addConsole("error", `Render failed: ${error instanceof Error ? error.message : String(error)}`, nextUrl);
      this.renderEmbedFallback(embed, nextUrl, hostName(nextUrl));
    }
  }

  getEmbedActiveTab(embed: HTMLElement): BrowserTab {
    const tab = this.ensureBrowserTab(embed.dataset.mwvActiveTabId || this.settings.activeBrowserTabId);
    embed.dataset.mwvActiveTabId = tab.id;
    this.settings.activeBrowserTabId = tab.id;
    return tab;
  }

  async syncEmbedActiveTab(embed: HTMLElement, url = embed.dataset.url || this.settings.homeUrl, title = ""): Promise<void> {
    const tab = this.getEmbedActiveTab(embed);
    await this.updateBrowserTab(tab.id, {
      title: title || this.getEmbedSurfaceTitle(embed) || hostName(url),
      url,
      back: this.getEmbedStack(embed, "mwvBack"),
      forward: this.getEmbedStack(embed, "mwvForward"),
      time: Date.now()
    });
  }

  async switchEmbedBrowserTab(embed: HTMLElement, id: string): Promise<void> {
    if (embed.dataset.mwvActiveTabId === id) return;
    await this.flushEmbedReaderNow(embed);
    await this.syncEmbedActiveTab(embed);
    const tab = this.settings.browserTabs.find((item) => item.id === id);
    if (!tab) return;
    embed.dataset.mwvActiveTabId = tab.id;
    this.settings.activeBrowserTabId = tab.id;
    this.setEmbedStack(embed, "mwvBack", tab.back ?? []);
    this.setEmbedStack(embed, "mwvForward", tab.forward ?? []);
    this.settings.noteBrowserUrl = tab.url;
    this.settings.noteBrowserBack = [...(tab.back ?? [])];
    this.settings.noteBrowserForward = [...(tab.forward ?? [])];
    await this.saveSettings();
    await this.openUrlInEmbed(embed, tab.url, false);
    this.emitApiEvent({ type: "tab-change", tabId: id, url: tab.url, title: tab.title, detail: { operation: "switch" } });
  }

  async newEmbedBrowserTab(embed: HTMLElement, url = this.settings.homeUrl): Promise<void> {
    await this.flushEmbedReaderNow(embed);
    await this.syncEmbedActiveTab(embed);
    const tab = this.createBrowserTab(url);
    this.settings.browserTabs = [
      tab,
      ...this.settings.browserTabs.filter((item) => item.id !== tab.id)
    ].slice(0, MAX_BROWSER_TABS);
    this.settings.activeBrowserTabId = tab.id;
    embed.dataset.mwvActiveTabId = tab.id;
    this.setEmbedStack(embed, "mwvBack", []);
    this.setEmbedStack(embed, "mwvForward", []);
    await this.saveSettings();
    await this.openUrlInEmbed(embed, tab.url, false);
    this.emitApiEvent({ type: "tab-change", tabId: tab.id, url: tab.url, title: tab.title, detail: { operation: "new" } });
  }

  async closeEmbedBrowserTab(embed: HTMLElement, id: string): Promise<void> {
    await this.flushEmbedReaderNow(embed);
    await this.syncEmbedActiveTab(embed);
    const tabs = this.settings.browserTabs;
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    if (tabs.length === 1) {
      const replacement = this.createBrowserTab(this.settings.homeUrl);
      this.settings.browserTabs = [replacement];
      this.settings.activeBrowserTabId = replacement.id;
      embed.dataset.mwvActiveTabId = replacement.id;
      await this.saveSettings();
      await this.openUrlInEmbed(embed, replacement.url, false);
      this.emitApiEvent({ type: "tab-close", tabId: id, detail: { activeTabId: replacement.id } });
      return;
    }
    tabs.splice(index, 1);
    this.emitApiEvent({ type: "tab-close", tabId: id });
    if (embed.dataset.mwvActiveTabId === id) {
      const next = tabs[Math.min(index, tabs.length - 1)];
      embed.dataset.mwvActiveTabId = next.id;
      this.settings.activeBrowserTabId = next.id;
      await this.saveSettings();
      await this.openUrlInEmbed(embed, next.url, false);
      return;
    }
    await this.saveSettings();
    this.renderEmbedTabStrip(embed);
  }

  async navigateEmbedBack(embed: HTMLElement): Promise<void> {
    await this.flushEmbedReaderNow(embed);
    const surface = embed.querySelector<BrowserSurfaceElement>(".mwv-live-frame");
    if (this.isBrowserSurfaceReady(surface) && this.isElectronWebview(surface) && surface.canGoBack?.()) {
      embed.dataset.mwvNativeNavigation = "back";
      surface.goBack?.();
      return;
    }
    const back = this.getEmbedStack(embed, "mwvBack");
    const current = embed.dataset.url;
    let previous = back.pop();
    while (previous && equivalentEmbedUrl(previous, current)) previous = back.pop();
    if (!previous) {
      this.setEmbedStack(embed, "mwvBack", back);
      await this.persistEmbedState(embed);
      this.syncNoteBrowserNativeIdentity(embed, embed.dataset.url || this.settings.homeUrl);
      return;
    }
    if (current) {
      const forward = this.getEmbedStack(embed, "mwvForward");
      forward.push(current);
      this.setEmbedStack(embed, "mwvForward", forward);
    }
    this.setEmbedStack(embed, "mwvBack", back);
    await this.persistEmbedState(embed);
    await this.openUrlInEmbed(embed, previous, false);
  }

  async navigateEmbedForward(embed: HTMLElement): Promise<void> {
    await this.flushEmbedReaderNow(embed);
    const surface = embed.querySelector<BrowserSurfaceElement>(".mwv-live-frame");
    if (this.isBrowserSurfaceReady(surface) && this.isElectronWebview(surface) && surface.canGoForward?.()) {
      embed.dataset.mwvNativeNavigation = "forward";
      surface.goForward?.();
      return;
    }
    const forward = this.getEmbedStack(embed, "mwvForward");
    const current = embed.dataset.url;
    let next = forward.pop();
    while (next && equivalentEmbedUrl(next, current)) next = forward.pop();
    if (!next) return;
    if (current) {
      const back = this.getEmbedStack(embed, "mwvBack");
      back.push(current);
      this.setEmbedStack(embed, "mwvBack", back);
    }
    this.setEmbedStack(embed, "mwvForward", forward);
    await this.persistEmbedState(embed);
    await this.openUrlInEmbed(embed, next, false);
  }

  async refreshEmbed(embed: HTMLElement): Promise<void> {
    await this.flushEmbedReaderNow(embed);
    const surface = embed.querySelector<BrowserSurfaceElement>(".mwv-live-frame");
    if (this.isBrowserSurfaceReady(surface) && this.isElectronWebview(surface) && surface.reload) {
      surface.reload();
      return;
    }
    await this.openUrlInEmbed(embed, embed.dataset.url ?? this.settings.homeUrl, false);
  }

  async persistEmbedState(embed: HTMLElement): Promise<void> {
    this.settings.noteBrowserUrl = embed.dataset.url || this.settings.homeUrl;
    this.settings.noteBrowserBack = this.getEmbedStack(embed, "mwvBack");
    this.settings.noteBrowserForward = this.getEmbedStack(embed, "mwvForward");
    await this.saveSettings();
  }

  renderEmbedTabStrip(embed: HTMLElement): void {
    const strip = embed.querySelector<HTMLElement>(".mwv-embed-tab-strip");
    if (!strip) return;
    strip.empty();
    const activeTab = this.getEmbedActiveTab(embed);
    const tabs = this.settings.browserTabs.length ? this.settings.browserTabs : [activeTab];
    for (const tab of tabs.slice(0, MAX_BROWSER_TABS)) {
      const item = strip.createEl("button", {
        cls: tab.id === activeTab.id ? "mwv-browser-tab is-active" : "mwv-browser-tab",
        attr: { type: "button", title: tab.url }
      });
      item.createSpan({ cls: "mwv-browser-tab-title", text: tab.title || hostName(tab.url) || "New tab" });
      const close = item.createSpan({ cls: "mwv-browser-tab-close", attr: { "aria-hidden": "true" } });
      setIcon(close, "x");
      item.addEventListener("click", (event) => {
        runAsync(async () => {
        const target = event.target as HTMLElement | null;
        event.preventDefault();
        event.stopPropagation();
        if (target?.closest(".mwv-browser-tab-close")) {
          await this.closeEmbedBrowserTab(embed, tab.id);
        } else {
          await this.switchEmbedBrowserTab(embed, tab.id);
        }
        });
      });
    }
    const add = strip.createEl("button", {
      cls: "mwv-browser-tab-add",
      attr: { type: "button", title: this.tr("newTab"), "aria-label": this.tr("newTab") }
    });
    setIcon(add, "plus");
    add.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.newEmbedBrowserTab(embed);
    });
  }

  renderUtilityEmbed(embed: HTMLElement, kind: UtilityPageKind, url = utilityPageUrl(kind)): void {
    this.disposeBrowserSurfacesIn(embed);
    embed.empty();
    embed.addClass("mwv-embed");
    embed.addClass("mwv-note-embed");
    embed.addClass("mwv-utility-embed");
    embed.removeClass("mwv-bing-home");
    embed.dataset.url = url;
    embed.setAttribute("data-url", url);
    const title = this.tr(utilityPageTitleKey(kind));
    this.renderBrowserChrome(embed, url, title);
    const page = embed.createEl("article", { cls: "mwv-note-surface mwv-utility-page" });
    page.dataset.url = url;
    page.createEl("h2", { cls: "mwv-page-title", text: title });
    const content = page.createDiv({ cls: "mwv-utility-content" });
    if (kind === "downloads") {
      this.renderEmbedUtilitySummary(content, [
        [this.tr("all"), String(this.settings.downloads.length)],
        [this.tr("completed"), String(this.settings.downloads.filter((entry) => entry.status === "completed").length)],
        [this.tr("failed"), String(this.settings.downloads.filter((entry) => entry.status === "error").length)]
      ]);
      this.renderDownloadUtilityList(content, embed, this.settings.downloads);
    } else if (kind === "console") {
      this.renderConsoleUtilityList(content, this.settings.consoleEntries);
    } else if (kind === "cancip") {
      this.renderCancipUtilityContent(content, embed);
    } else {
      const entries =
        kind === "bookmarks"
          ? this.settings.bookmarks.filter((entry) => !isBuiltInShortcut(entry))
          : kind === "reading"
          ? this.settings.readingList
          : this.settings.history;
      if (kind === "history") {
        const today = new Date().toDateString();
        this.renderEmbedUtilitySummary(content, [
          [this.tr("all"), String(entries.length)],
          [this.tr("today"), String(entries.filter((entry) => new Date(entry.time).toDateString() === today).length)],
          [this.tr("latest"), entries[0] ? hostName(entries[0].url) : "-"]
        ]);
      }
      this.renderEntryUtilityList(content, embed, entries, entries.length ? "" : this.tr("noEntries"));
    }
    this.notifyNoteDrawWebviewChanged(embed);
  }

  renderEmbedUtilitySummary(parent: HTMLElement, items: [string, string][]): void {
    const summary = parent.createDiv({ cls: "mwv-utility-summary" });
    for (const [label, value] of items) {
      const card = summary.createDiv({ cls: "mwv-utility-summary-card" });
      card.createDiv({ cls: "mwv-utility-summary-label", text: label });
      card.createDiv({ cls: "mwv-utility-summary-value", text: value });
    }
  }

  renderEntryUtilityList(parent: HTMLElement, embed: HTMLElement, entries: WebEntry[], emptyText: string): void {
    if (!entries.length) {
      parent.createDiv({ cls: "mwv-empty", text: emptyText || this.tr("noEntries") });
      return;
    }
    const list = parent.createDiv({ cls: "mwv-utility-list" });
    for (const entry of entries.slice(0, 120)) {
      const item = list.createDiv({ cls: "mwv-utility-item" });
      const main = item.createEl("button", { cls: "mwv-utility-main", attr: { type: "button", title: entry.url } });
      const meta = main.createDiv({ cls: "mwv-utility-meta" });
      meta.createSpan({ cls: "mwv-utility-host", text: hostName(entry.url) });
      meta.createSpan({ cls: "mwv-utility-time", text: new Date(entry.time).toLocaleString() });
      main.createDiv({ cls: "mwv-utility-title", text: entry.title || hostName(entry.url) });
      main.createDiv({ cls: "mwv-utility-url", text: entry.url });
      main.addEventListener("click", () => void this.newEmbedBrowserTab(embed, entry.url));
      const row = item.createDiv({ cls: "mwv-utility-actions" });
      const open = row.createEl("button", { cls: "mwv-mini-action", text: this.tr("newTab"), attr: { type: "button" } });
      open.addEventListener("click", () => void this.newEmbedBrowserTab(embed, entry.url));
      const current = row.createEl("button", { cls: "mwv-mini-action", text: this.tr("currentOpen"), attr: { type: "button" } });
      current.addEventListener("click", () => void this.openUrlInEmbed(embed, entry.url));
      const copy = row.createEl("button", { cls: "mwv-mini-action", text: this.tr("copy"), attr: { type: "button" } });
      copy.addEventListener("click", () => runAsync(async () => {
        await navigator.clipboard.writeText(`[${entry.title || hostName(entry.url)}](${entry.url})`);
        new Notice(this.tr("copiedLink"));
      }));
    }
  }

  renderDownloadUtilityList(parent: HTMLElement, embed: HTMLElement, entries: DownloadEntry[]): void {
    if (!entries.length) {
      parent.createDiv({ cls: "mwv-empty", text: this.tr("noDownloadsYet") });
      return;
    }
    const list = parent.createDiv({ cls: "mwv-download-list" });
    for (const entry of entries.slice(0, 120)) {
      const item = list.createDiv({ cls: `mwv-download-item is-${entry.status}` });
      const top = item.createDiv({ cls: "mwv-download-item-top" });
      top.createDiv({ cls: "mwv-download-item-title", text: entry.fileName || hostName(entry.url) });
      top.createDiv({ cls: "mwv-download-item-state", text: this.tr("downloadState", { status: entry.status, progress: Math.round(entry.progress) }) });
      const progress = item.createDiv({ cls: "mwv-download-progress" });
      progress.createDiv({ cls: "mwv-download-progress-fill", attr: { style: `width:${clampNumber(entry.progress, 0, 100)}%` } });
      item.createDiv({ cls: "mwv-download-item-meta", text: `${entry.connections} connection${entry.connections === 1 ? "" : "s"} · ${entry.resumable ? "Range" : "single"} · ${entry.format.toUpperCase()}` });
      item.createDiv({ cls: "mwv-download-item-path", text: entry.path || entry.message || entry.url });
      const row = item.createDiv({ cls: "mwv-download-list-actions" });
      const open = row.createEl("button", { cls: "mwv-mini-action", text: this.tr("openFile"), attr: { type: "button" } });
      open.addEventListener("click", () => void this.openDownloadEntry(entry));
      const copy = row.createEl("button", { cls: "mwv-mini-action", text: this.tr("copyPath"), attr: { type: "button" } });
      copy.addEventListener("click", () => void this.copyDownloadPath(entry));
      const locate = row.createEl("button", { cls: "mwv-mini-action", text: this.tr("location"), attr: { type: "button" } });
      locate.addEventListener("click", () => void this.revealDownloadEntry(entry));
      if (entry.url && /^https?:\/\//i.test(entry.url)) {
        const source = row.createEl("button", { cls: "mwv-mini-action", text: this.tr("source"), attr: { type: "button" } });
        source.addEventListener("click", () => void this.newEmbedBrowserTab(embed, entry.url));
      }
    }
  }

  renderConsoleUtilityList(parent: HTMLElement, entries: BrowserConsoleEntry[]): void {
    parent.empty();
    if (!entries.length) {
      parent.createDiv({ cls: "mwv-empty", text: this.tr("noConsoleLogs") });
      return;
    }
    for (const entry of entries.slice(0, 120)) {
      const item = parent.createDiv({ cls: `mwv-console-list-item is-${entry.level}` });
      item.createDiv({ cls: "mwv-console-list-meta", text: `${entry.level.toUpperCase()} · ${new Date(entry.time).toLocaleString()}` });
      item.createDiv({ cls: "mwv-console-list-message", text: entry.message });
      if (entry.url) item.createDiv({ cls: "mwv-console-list-url", text: entry.url });
    }
  }

  renderCancipUtilityContent(parent: HTMLElement, embed: HTMLElement): void {
    parent.empty();
    const status = this.getCancipStatus();
    const contextUrl = internalUtilityContextUrl(embed.dataset.url) || this.settings.noteBrowserUrl || this.settings.homeUrl;
    const card = parent.createDiv({ cls: "mwv-cancip-card" });
    card.createDiv({ cls: "mwv-cancip-title", text: status.enabled ? this.tr("cancipDetected") : this.tr("cancipNotEnabled") });
    card.createDiv({ cls: "mwv-cancip-desc", text: status.enabled ? this.tr("cancipDetectedDesc", { version: status.version || "unknown" }) : this.tr("cancipNotEnabledDesc") });
    const row = card.createDiv({ cls: "mwv-utility-actions" });
    const open = row.createEl("button", { cls: "mwv-mini-action", text: this.tr("openCancip"), attr: { type: "button" } });
    open.disabled = !status.enabled;
    open.addEventListener("click", () => void this.openCancip());
    const send = row.createEl("button", { cls: "mwv-mini-action", text: this.tr("sendCurrentToCancip"), attr: { type: "button" } });
    send.disabled = !status.enabled;
    send.addEventListener("click", () => runAsync(async () => {
      await this.sendCurrentToCancip({ reveal: true, focus: true });
      new Notice(this.tr("sentCurrentToCancip"));
    }));
    const copy = row.createEl("button", { cls: "mwv-mini-action", text: this.tr("copyCurrentContext"), attr: { type: "button" } });
    copy.addEventListener("click", () => runAsync(async () => {
      await navigator.clipboard.writeText([
        "Mobile Webviewer context",
        `URL: ${contextUrl}`,
        `Title: ${hostName(contextUrl)}`,
        "",
        this.tr("cancipContextPrompt")
      ].join("\n"));
      new Notice(this.tr("copiedCancipContext"));
    }));
  }

  flushEmbedReader(embed: HTMLElement): void {
    void this.flushEmbedReaderNow(embed);
  }

  async flushEmbedReaderNow(embed: HTMLElement): Promise<void> {
    const panels = Array.from(embed.querySelectorAll<WebNotePanelElement>(".mwv-reader-panel"));
    const flushes: Promise<unknown>[] = [];
    for (const panel of panels) {
      try {
        const flush = Promise.resolve(panel._mwvFlushWebNote?.()).catch((error) => {
          console.error("[mobile-webviewer] reader flush failed", error);
        });
        flushes.push(flush);
      } catch (error) {
        console.error("[mobile-webviewer] reader flush failed", error);
      }
      panel.removeClass("is-doodling");
      panel.querySelectorAll<HTMLButtonElement>("[data-mwv-doodle-toggle]").forEach((button) => {
        button.removeClass("is-active");
        button.setAttribute("aria-pressed", "false");
        button.setAttribute("title", "Doodle");
        button.setAttribute("aria-label", "Doodle");
      });
    }
    await Promise.all(flushes);
  }

  async prepareEmbedForRerender(embed: HTMLElement): Promise<void> {
    if (this.disposed) return;
    await this.flushEmbedReaderNow(embed);
    if (this.disposed) return;
    await this.resetNoteDrawWebviewControllers(embed);
    if (this.disposed) return;
    // The Note and Web presentations share one live page. Keep that WebView
    // mounted across host-side reader/search rerenders so session state,
    // history, cookies, and the current document are not forked.
    const liveBrowser = embed.querySelector<HTMLElement>(":scope > .mwv-live-browser");
    if (liveBrowser?.querySelector(":scope > .mwv-live-frame")) {
      Array.from(embed.children).forEach((child) => {
        if (child !== liveBrowser) child.remove();
      });
    } else {
      this.disposeBrowserSurfacesIn(embed);
    }
  }

  async renderEmbed(embed: HTMLElement, url: string): Promise<void> {
    const renderToken = ++this.embedRenderSeq;
    this.embedRenderTokens.set(embed, renderToken);
    if (this.disposed || !embed.isConnected) return;
    const obsidianLink = parseObsidianOpenLink(url);
    if (obsidianLink) {
      await this.renderObsidianNoteEmbed(embed, obsidianLink, url);
      const file = this.resolveObsidianOpenFile(obsidianLink);
      await this.syncEmbedActiveTab(embed, url, file?.basename || obsidianLink.file);
      return;
    }
    const utilityKind = internalUtilityKind(url);
    if (utilityKind) {
      this.renderUtilityEmbed(embed, utilityKind, url);
      await this.syncEmbedActiveTab(embed, url, utilityPageTitle(utilityKind));
      return;
    }
    const query = this.extractBingQuery(url);
    if (this.isBingHome(url) || query !== null) {
      await this.renderBingShellEmbed(embed, query ?? "");
      await this.syncEmbedActiveTab(embed, url, query ? `Bing: ${query}` : "Bing");
      return;
    }

    await this.prepareEmbedForRerender(embed);
    const retainedLiveBrowser = embed.querySelector<HTMLElement>(":scope > .mwv-live-browser");
    if (retainedLiveBrowser?.querySelector(":scope > .mwv-live-frame")) {
      Array.from(embed.children).forEach((child) => {
        if (child !== retainedLiveBrowser) child.remove();
      });
    } else {
      embed.empty();
    }
    embed.addClass("mwv-embed");
    embed.addClass("mwv-note-embed");
    embed.dataset.url = url;
    embed.setAttribute("data-url", url);
    embed.removeClass("mwv-bing-home");
    this.renderBrowserChrome(embed, url, this.tr("loading"));
    if (retainedLiveBrowser) {
      const retainedFrame = retainedLiveBrowser.querySelector<BrowserSurfaceElement>(":scope > .mwv-live-frame");
      if (retainedFrame && !this.sameWebPage(this.safeBrowserSurfaceUrl(retainedFrame), url)) {
        this.setBrowserSurfaceUrl(retainedFrame, url);
      }
    }
    this.notifyNoteDrawWebviewChanged(embed);

    if (this.settings.liveBrowserFirst) {
      const reader = embed.createDiv({ cls: "mwv-reader-panel is-loading mwv-note-front-panel" });
      reader.createDiv({ cls: "mwv-reader-panel-title", text: this.tr("reader") });
      reader.createDiv({ cls: "mwv-reader-loading-text", text: this.tr("readerExtracting") });
      try {
        const page = await this.fetchNotePage(url);
        const note = await this.ensureWebNote(page);
        this.renderReaderPanel(reader, page, note, embed);
      } catch (error) {
        console.error("[mobile-webviewer] reader extraction failed", error);
        void this.addConsole("warn", "Reader extraction skipped", url);
        const fallback = await this.fetchFallbackNotePage(url, error instanceof Error ? error.message : "Reader extraction skipped");
        const note = await this.ensureWebNote(fallback);
        if (embed.isConnected && embed.dataset.url === url) {
          this.renderReaderPanel(reader, fallback, note, embed);
        }
      }
      return;
    }

    try {
      const page = await this.fetchNotePage(url);
      this.renderPageEmbed(embed, page);
    } catch (error) {
      console.error("[mobile-webviewer] reader-first extraction failed", error);
      void this.addConsole("warn", "Reader-first extraction skipped", url);
      await this.prepareEmbedForRerender(embed);
      embed.empty();
      embed.addClass("mwv-embed");
      embed.addClass("mwv-note-embed");
      embed.dataset.url = url;
      embed.setAttribute("data-url", url);
      embed.removeClass("mwv-bing-home");
      this.renderBrowserChrome(embed, url, hostName(url));
      this.renderLiveBrowserSurface(embed, url);
      this.notifyNoteDrawWebviewChanged(embed);
    }
  }

  renderEmbedFallback(embed: HTMLElement, url: string, title: string): void {
    this.disposeBrowserSurfacesIn(embed);
    embed.empty();
    embed.addClass("mwv-embed");
    embed.addClass("mwv-note-embed");
    embed.removeClass("mwv-bing-home");
    embed.dataset.url = url;
    embed.setAttribute("data-url", url);
    embed.dataset.mwvProgrammaticUrl = url;
    this.renderBrowserChrome(embed, url, title || hostName(url));
    this.renderLiveBrowserSurface(embed, url);
    this.updateEmbedStatus(embed, url, hostName(url));
    this.notifyNoteDrawWebviewChanged(embed);
  }

  renderLiveBrowserSurface(embed: HTMLElement, url: string): void {
    this.applyBrowserRuntimeClasses(embed);
    const existing = Array.from(embed.children)
      .filter((child): child is HTMLElement => child instanceof HTMLElement && child.hasClass("mwv-live-browser"));
    const surface = existing[0] ?? embed.createDiv({ cls: "mwv-live-browser" });
    for (const duplicate of existing.slice(1)) {
      this.disposeBrowserSurfacesIn(duplicate);
      duplicate.remove();
    }
    if (surface.querySelector(":scope > .mwv-live-frame")) {
      this.notifyNoteDrawWebviewChanged(embed);
      return;
    }
    surface.addClass("mwv-live-browser");
    const frame = this.createBrowserSurface(surface, url, "mwv-live-frame", hostName(url), {
      raw: true,
      onReady: () => {
        void this.applyAccessibleFrameFilters(frame, embed.dataset.url || url);
        if (this.isNoteBrowserRawEditingMode(embed) && embed.dataset.mwvNotewebElementSelector === "true") {
          void this.setNoteWebRawElementSelector(embed, true);
        }
        this.notifyNoteDrawWebviewChanged(embed);
      },
      onNavigate: (nextUrl) => { void this.handleEmbedSurfaceNavigate(embed, nextUrl); },
      onTitle: (title) => this.handleEmbedSurfaceTitle(embed, title),
      onFail: (message, failedUrl) => {
        const currentUrl = failedUrl ?? embed.dataset.url ?? url;
        this.updateEmbedStatus(embed, currentUrl, hostName(currentUrl));
        void this.addConsole("warn", `Note Browser load issue: ${message}`, currentUrl);
        // In Web mode the guest page is the primary surface. Do not let a
        // transient top-level load error replace it with reader HTML after
        // the first paint; that replacement is the source of the delayed
        // "good for a moment, then broken" layout.
        if (embed.hasClass("is-web-front")) return;
        void this.renderEmbedReaderFallback(embed, currentUrl, message);
        this.notifyNoteDrawWebviewChanged(embed);
      },
      onConsole: (level, message, pageUrl) => this.addConsole(level, message, pageUrl ?? embed.dataset.url ?? url),
      onNewWindow: (nextUrl) => this.openNoteBrowser(nextUrl, true),
      onLoading: (loading, loadingUrl) => {
        this.updateEmbedLoading(embed, loading, loadingUrl || url);
        if (!loading) this.notifyNoteDrawWebviewChanged(embed);
      },
      onFavicon: (iconUrl) => this.addConsole("info", `Favicon: ${iconUrl}`, embed.dataset.url || url),
      onDownloadCandidate: (downloadUrl) => this.handleEmbedDownloadCandidate(embed, downloadUrl),
      onContextLink: (linkUrl, linkTitle) => this.updateEmbedStatus(embed, linkUrl, linkTitle),
      onWebNotePatch: (patch) => { void this.saveBrowserSurfaceWebNotePatch(patch); }
    });
    this.applyFrameViewPreferences(frame);
  }

  updateEmbedLoading(embed: HTMLElement, loading: boolean, url: string): void {
    embed.toggleClass("is-loading", loading);
    const lock = embed.querySelector<HTMLElement>(".mwv-browser-lock");
    if (lock) lock.setText(loading ? "load" : /^https:\/\//i.test(url) ? "https" : "page");
    const status = embed.querySelector<HTMLElement>(".mwv-browser-status-text");
    if (status) status.setText(loading ? `Loading ${hostName(url)}` : hostName(url));
  }

  async handleEmbedDownloadCandidate(embed: HTMLElement, url: string): Promise<void> {
    await this.addConsole("info", `Detected download link: ${url}`, embed.dataset.url || url);
    const entry = await this.downloadUrlFile(url);
    new Notice(this.tr("downloadComplete", { path: entry.path || entry.message }));
  }

  async syncEmbedReaderFromUrl(embed: HTMLElement, url: string): Promise<void> {
    if (!embed.isConnected || embed.hasClass("mwv-bing-home")) return;
    const reader = embed.querySelector<HTMLElement>(".mwv-reader-panel");
    if (!reader || embed.hasClass("is-web-front")) return;
    reader.addClass("is-loading");
    try {
      const page = await this.fetchNotePage(url);
      const note = await this.ensureWebNote(page);
      if (!embed.isConnected || embed.dataset.url !== url) return;
      this.renderReaderPanel(reader, page, note, embed);
      this.notifyNoteDrawWebviewChanged(embed, true);
    } catch (error) {
      console.error("[mobile-webviewer] reader sync failed", error);
      reader.removeClass("is-loading");
      void this.addConsole("warn", "Reader sync skipped", url);
    }
  }

  async handleEmbedSurfaceNavigate(embed: HTMLElement, url: string): Promise<void> {
    if (!url || url === "about:blank" || url.startsWith("devtools://")) return;
    const nextUrl = normalizeInput(url, this.settings.searchUrl);
    const previous = embed.dataset.url;
    const programmaticUrl = embed.dataset.mwvProgrammaticUrl;
    const nativeNavigation = embed.dataset.mwvNativeNavigation;
    delete embed.dataset.mwvNativeNavigation;
    const sameDocument = equivalentEmbedUrl(previous, nextUrl);
    if (previous && !sameDocument) {
      await this.flushEmbedReaderNow(embed);
      await this.resetNoteDrawWebviewControllers(embed);
    }
    if (nativeNavigation === "back" && previous && !sameDocument) {
      const back = this.getEmbedStack(embed, "mwvBack");
      const matchIndex = back.lastIndexOf(nextUrl);
      this.setEmbedStack(embed, "mwvBack", matchIndex >= 0 ? back.slice(0, matchIndex) : back.slice(0, -1));
      const forward = this.getEmbedStack(embed, "mwvForward");
      forward.push(previous);
      this.setEmbedStack(embed, "mwvForward", forward);
    } else if (nativeNavigation === "forward" && previous && !sameDocument) {
      const forward = this.getEmbedStack(embed, "mwvForward");
      const matchIndex = forward.lastIndexOf(nextUrl);
      this.setEmbedStack(embed, "mwvForward", matchIndex >= 0 ? forward.slice(0, matchIndex) : forward.slice(0, -1));
      const back = this.getEmbedStack(embed, "mwvBack");
      back.push(previous);
      this.setEmbedStack(embed, "mwvBack", back);
    } else if (equivalentEmbedUrl(programmaticUrl, nextUrl)) {
      delete embed.dataset.mwvProgrammaticUrl;
    } else if (previous && !sameDocument) {
      const back = this.getEmbedStack(embed, "mwvBack");
      if (!back.includes(previous)) {
        back.push(previous);
        this.setEmbedStack(embed, "mwvBack", back);
      }
      this.setEmbedStack(embed, "mwvForward", []);
    }
    embed.dataset.url = nextUrl;
    embed.setAttribute("data-url", nextUrl);
    this.updateEmbedChrome(embed, nextUrl, this.getEmbedSurfaceTitle(embed) || hostName(nextUrl));
    this.notifyNoteDrawWebviewChanged(embed);
    void this.persistEmbedState(embed);
    void this.syncEmbedActiveTab(embed, nextUrl, this.getEmbedSurfaceTitle(embed) || hostName(nextUrl));
    void this.addHistory({
      title: this.getEmbedSurfaceTitle(embed) || hostName(nextUrl),
      url: nextUrl,
      time: Date.now()
    });
    this.emitApiEvent({
      type: "navigate",
      url: nextUrl,
      title: this.getEmbedSurfaceTitle(embed) || hostName(nextUrl),
      tabId: embed.dataset.mwvActiveTabId
    });
    window.setTimeout(() => void this.syncEmbedReaderFromUrl(embed, nextUrl), 600);
  }

  handleEmbedSurfaceTitle(embed: HTMLElement, title: string): void {
    const url = embed.dataset.url || this.settings.homeUrl;
    this.updateEmbedChrome(embed, url, title || hostName(url));
    void this.syncEmbedActiveTab(embed, url, title || hostName(url));
  }

  getEmbedSurfaceTitle(embed: HTMLElement): string {
    const surface = embed.querySelector<BrowserSurfaceElement>(".mwv-live-frame");
    return surface ? this.getBrowserSurfaceTitle(surface) : "";
  }

  updateEmbedChrome(embed: HTMLElement, url: string, title: string): void {
    embed.dataset.mwvCurrentTitle = title || hostName(url);
    const address = embed.querySelector<HTMLInputElement>(".mwv-browser-url");
    if (address && address.ownerDocument.activeElement !== address && !address.matches(":focus")) {
      address.value = url;
    }
    const form = embed.querySelector<HTMLElement>(".mwv-browser-address");
    if (form) form.setAttribute("title", url);
    const more = embed.querySelector<HTMLElement>(".mwv-browser-more");
    if (more) {
      more.dataset.mwvUrl = url;
      more.dataset.mwvTitle = title;
    }
    this.syncNoteBrowserNativeIdentity(embed, url);
  }

  updateEmbedStatus(embed: HTMLElement, url: string, title = ""): void {
    const status = embed.querySelector<HTMLElement>(".mwv-browser-status-text");
    if (status) status.setText(title ? `${title} · ${hostName(url)}` : url);
  }

  renderReaderPanel(panel: HTMLElement, page: NotePage, note?: WebNoteEntry, embed?: HTMLElement): void {
    const statePanel = panel as WebNotePanelElement;
    try {
      statePanel._mwvFinishDoodle?.();
      void statePanel._mwvFlushWebNote?.();
      if (statePanel._mwvFlushTimer) {
        window.clearTimeout(statePanel._mwvFlushTimer);
        delete statePanel._mwvFlushTimer;
      }
    } catch (error) {
      console.error("[mobile-webviewer] reader flush before rerender failed", error);
    }
    delete statePanel._mwvFinishDoodle;
    delete statePanel._mwvFlushWebNote;
    delete statePanel._mwvFlushTimer;
    panel.empty();
    panel.removeClass("is-loading");
    panel.dataset.url = page.url;
    panel.setAttribute("data-url", page.url);
    panel.createDiv({ cls: "mwv-reader-panel-title", text: this.tr("reader") });
    panel.createDiv({ cls: "mwv-note-source", text: page.byline || hostName(page.url) });
    panel.createEl("h2", { cls: "mwv-page-title", text: page.title || hostName(page.url) });
    const actions = panel.createDiv({ cls: "mwv-note-actions" });
    const status = actions.createSpan({ cls: "mwv-webnote-status" });
    if (page.images.length) {
      const media = panel.createDiv({ cls: "mwv-page-media" });
      for (const image of page.images.slice(0, 4)) {
        media.createEl("img", { attr: { src: image, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" } });
      }
    }
    const noteWrap = panel.createDiv({ cls: "mwv-webnote-wrap" });
    const content = noteWrap.createDiv({
      cls: "mwv-md-content mwv-webnote-editor",
      attr: { contenteditable: "true", spellcheck: "true" }
    });
    if (note?.noteHtml) {
      appendSafeHtml(content, note.noteHtml);
    } else {
      const blocks = page.content.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
      const visibleBlocks = blocks.length ? blocks : [page.excerpt].filter(Boolean);
      if (!visibleBlocks.length && !page.images.length) {
        panel.remove();
        return;
      }
      for (const block of visibleBlocks.slice(0, 40)) {
        const clean = block.replace(/^#{1,3}\s+/, "");
        if (clean) content.createEl("p", { text: clean });
      }
    }
    const doodleLayer = content.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
    doodleLayer.addClass("mwv-doodle-layer");
    doodleLayer.setAttribute("viewBox", "0 0 1000 1000");
    doodleLayer.setAttribute("preserveAspectRatio", "none");
    doodleLayer.setAttribute("aria-hidden", "true");
    if (note?.doodleSvg) {
      appendSafeDoodleSvg(doodleLayer, note.doodleSvg);
    }
    noteWrap.appendChild(doodleLayer);
    let currentNote = note;
    let activePath: SVGPathElement | undefined;
    let activePointerId: number | undefined;
    const save = async () => {
      if (!panel.isConnected || panel.dataset.url !== page.url) return currentNote;
      const base = currentNote ?? this.createWebNoteFromPage(page);
      const saved = await this.saveWebNote({
        ...base,
        noteHtml: content.innerHTML,
        noteText: htmlToMarkdownFromElement(content),
        doodleSvg: doodleLayer.innerHTML,
        updatedAt: Date.now()
      });
      currentNote = saved;
      status.setText("");
      return saved;
    };
    const queue = () => {
      if (!this.settings.autoSaveWebNotes) return;
      status.setText("");
      if (statePanel._mwvFlushTimer) window.clearTimeout(statePanel._mwvFlushTimer);
      statePanel._mwvFlushTimer = window.setTimeout(() => void save(), 450);
    };
    content.addEventListener("input", queue, true);
    content.addEventListener("keyup", queue, true);
    content.addEventListener("compositionend", queue, true);
    content.addEventListener("paste", () => window.setTimeout(queue, 0), true);
    content.addEventListener("blur", () => void save());
    const finishDoodle = (event?: PointerEvent, shouldQueue = true) => {
      if (!activePath) return;
      const pointerId = activePointerId ?? event?.pointerId;
      activePath = undefined;
      activePointerId = undefined;
      if (typeof pointerId === "number") {
        try {
          if (doodleLayer.hasPointerCapture?.(pointerId)) {
            doodleLayer.releasePointerCapture(pointerId);
          }
        } catch {
          // Pointer capture may already be released by the host.
        }
      }
      if (shouldQueue) {
        queue();
        void save();
      }
    };
    statePanel._mwvFinishDoodle = () => finishDoodle(undefined, true);
    statePanel._mwvFlushWebNote = async () => {
      finishDoodle(undefined, true);
      panel.removeClass("is-doodling");
      if (statePanel._mwvFlushTimer) {
        window.clearTimeout(statePanel._mwvFlushTimer);
        delete statePanel._mwvFlushTimer;
      }
      await save();
    };
    const point = (event: PointerEvent): [number, number] => {
      const rect = doodleLayer.getBoundingClientRect();
      const x = clampNumber(((event.clientX - rect.left) / Math.max(1, rect.width)) * 1000, 0, 1000);
      const y = clampNumber(((event.clientY - rect.top) / Math.max(1, rect.height)) * 1000, 0, 1000);
      return [x, y];
    };
    doodleLayer.addEventListener("pointerdown", (event) => {
      if (!panel.hasClass("is-doodling")) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      finishDoodle(event, false);
      const [x, y] = point(event);
      const path = doodleLayer.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${x.toFixed(1)} ${y.toFixed(1)}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "var(--interactive-accent)");
      path.setAttribute("stroke-width", "5");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      doodleLayer.appendChild(path);
      activePath = path;
      activePointerId = event.pointerId;
      try {
        doodleLayer.setPointerCapture(event.pointerId);
      } catch {
        // Some mobile hosts do not support explicit pointer capture.
      }
    });
    doodleLayer.addEventListener("pointermove", (event) => {
      if (!panel.hasClass("is-doodling") || !activePath || activePointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const [x, y] = point(event);
      activePath.setAttribute("d", `${activePath.getAttribute("d")} L ${x.toFixed(1)} ${y.toFixed(1)}`);
      status.setText("");
      queue();
    });
    doodleLayer.addEventListener("pointerup", finishDoodle);
    doodleLayer.addEventListener("pointercancel", finishDoodle);
    doodleLayer.addEventListener("pointerleave", finishDoodle);
    doodleLayer.addEventListener("lostpointercapture", finishDoodle);
    const finishFromWindow = (event?: Event) => {
      if (!activePath || activePath.ownerSVGElement !== doodleLayer) return;
      finishDoodle(event instanceof PointerEvent ? event : undefined);
    };
    this.registerDomEvent(window, "pointerup", finishFromWindow);
    this.registerDomEvent(window, "pointercancel", finishFromWindow);
    this.registerDomEvent(window, "blur", finishFromWindow);
    panel.addEventListener("focusout", () => void statePanel._mwvFlushWebNote?.(), true);
    this.applyReaderCustomizations(panel, page);
    if (embed) this.notifyNoteDrawWebviewChanged(embed, true);
  }

  async renderEmbedReaderFallback(embed: HTMLElement, url: string, reason = ""): Promise<void> {
    if (!embed.isConnected || embed.dataset.url !== url || embed.hasClass("mwv-bing-home")) return;
    let reader = embed.querySelector<HTMLElement>(".mwv-reader-panel");
    if (!reader) {
      reader = embed.createDiv({ cls: "mwv-reader-panel mwv-note-front-panel" });
    }
    reader.addClass("is-loading");
    try {
      const page = await this.fetchFallbackNotePage(url, reason);
      const note = await this.ensureWebNote(page);
      if (!embed.isConnected || embed.dataset.url !== url) return;
      this.renderReaderPanel(reader, page, note, embed);
      this.notifyNoteDrawWebviewChanged(embed, true);
    } catch (error) {
      console.error("[mobile-webviewer] embed fallback failed", error);
      reader.removeClass("is-loading");
      reader.empty();
      reader.createDiv({ cls: "mwv-reader-panel-title", text: this.tr("reader") });
      reader.createDiv({ cls: "mwv-note-source", text: hostName(url) });
      reader.createEl("h2", { cls: "mwv-page-title", text: hostName(url) || this.tr("page") });
      const content = reader.createDiv({ cls: "mwv-md-content mwv-webnote-editor", attr: { contenteditable: "true", spellcheck: "true" } });
      content.createEl("p", { text: reason || this.tr("pageLoadLimited") });
      content.createEl("p", { text: url });
    }
  }

  async renderBingShellEmbed(embed: HTMLElement, query = ""): Promise<void> {
    const renderToken = ++this.embedRenderSeq;
    this.embedRenderTokens.set(embed, renderToken);
    await this.prepareEmbedForRerender(embed);
    if (this.disposed || !embed.isConnected || this.embedRenderTokens.get(embed) !== renderToken) return;
    const retainedLiveBrowser = embed.querySelector<HTMLElement>(":scope > .mwv-live-browser");
    if (retainedLiveBrowser?.querySelector(":scope > .mwv-live-frame")) {
      Array.from(embed.children).forEach((child) => {
        if (child !== retainedLiveBrowser) child.remove();
      });
    } else {
      embed.empty();
    }
    embed.addClass("mwv-bing-home");
    embed.toggleClass("mwv-bing-home-empty", !query.trim());
    embed.toggleClass("mwv-bing-home-results", Boolean(query.trim()));
    embed.removeClass("mwv-note-embed");

    const currentUrl = query
      ? DEFAULT_SEARCH.replace("{{query}}", encodeURIComponent(query))
      : this.settings.homeUrl;
    embed.addClass("mwv-embed");
    embed.dataset.url = currentUrl;
    embed.setAttribute("data-url", currentUrl);
    this.renderBrowserChrome(embed, currentUrl, query ? `Bing: ${query}` : "Bing");
    if (retainedLiveBrowser) {
      const retainedFrame = retainedLiveBrowser.querySelector<BrowserSurfaceElement>(":scope > .mwv-live-frame");
      if (retainedFrame && !this.sameWebPage(this.safeBrowserSurfaceUrl(retainedFrame), currentUrl)) {
        this.setBrowserSurfaceUrl(retainedFrame, currentUrl);
      }
    }
    this.notifyNoteDrawWebviewChanged(embed);

    const noteContent = embed.createDiv({ cls: "mwv-bing-note-content" });
    const searchHeader = query.trim()
      ? noteContent.createDiv({ cls: "mwv-bing-serp-head" })
      : noteContent;

    if (query.trim()) {
      const brand = searchHeader.createDiv({ cls: "mwv-bing-mini-brand" });
      brand.createSpan({ cls: "mwv-ms-dot mwv-ms-red" });
      brand.createSpan({ cls: "mwv-ms-dot mwv-ms-green" });
      brand.createSpan({ cls: "mwv-ms-dot mwv-ms-blue" });
      brand.createSpan({ cls: "mwv-ms-dot mwv-ms-yellow" });
    } else {
      noteContent.createDiv({ cls: "mwv-bing-logo", text: "Bing" });
    }

    const search = searchHeader.createDiv({ cls: "mwv-bing-search", attr: { role: "search" } });
    const input = search.createEl("input", {
      cls: "mwv-bing-input",
      value: query,
      attr: {
        type: "search",
        placeholder: this.tr("searchBing"),
        autocomplete: "off"
      }
    });
    const submit = search.createEl("button", {
      cls: "mwv-bing-submit",
      text: "→",
      attr: { type: "button" }
    });

    if (query.trim()) {
      const tabs = noteContent.createDiv({ cls: "mwv-bing-tabs" });
      const tabItems = [
        [this.tr("webResultsTab"), DEFAULT_SEARCH.replace("{{query}}", encodeURIComponent(query))],
        [this.tr("imageResultsTab"), `https://www.bing.com/images/search?q=${encodeURIComponent(query)}`],
        [this.tr("videoResultsTab"), `https://www.bing.com/videos/search?q=${encodeURIComponent(query)}`],
        [this.tr("academicTab"), `https://www.bing.com/search?q=${encodeURIComponent(`${query} academic`)}`],
        [this.tr("dictionaryTab"), `https://www.bing.com/search?q=${encodeURIComponent(`${query} dictionary`)}`],
        [this.tr("mapsTab"), `https://www.bing.com/maps?q=${encodeURIComponent(query)}`],
        [this.tr("moreTab"), DEFAULT_SEARCH.replace("{{query}}", encodeURIComponent(`${query} more`))]
      ];
      tabItems.forEach((item, index) => {
        const tab = tabs.createEl("button", {
          cls: index === 0 ? "mwv-bing-tab is-active" : "mwv-bing-tab",
          attr: { type: "button", "data-mwv-open-url": item[1] }
        });
        tab.createSpan({ text: item[0] });
      });
    }

    const resultHost = noteContent.createDiv({ cls: "mwv-bing-results" });
    const runSearch = async (event?: Event) => {
      event?.preventDefault();
      event?.stopPropagation();
      await this.runBingHomeSearch(embed, input, resultHost);
    };

    submit.addEventListener("click", (event) => {
      runAsync(() => runSearch(event));
    }, true);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        void runSearch(event);
      }
    }, true);

    if (query.trim()) {
      void this.runBingHomeSearch(embed, input, resultHost);
    }
  }

  bindBingHomeEmbed(embed: HTMLElement, url: string): void {
    embed.addClass("mwv-bing-home-bound");

    const form = embed.querySelector<HTMLElement>(".mwv-bing-search");
    const input = embed.querySelector<HTMLInputElement>("input.mwv-bing-input");
    const submit = embed.querySelector<HTMLButtonElement>(".mwv-bing-submit");
    const resultHost =
      embed.querySelector<HTMLElement>(".mwv-bing-results") ??
      embed.createDiv({ cls: "mwv-bing-results" });

    if (!form || !input) return;
    if (form.dataset.mwvBound) return;
    form.dataset.mwvBound = "true";

    const runSearch = async (event?: Event) => {
      event?.preventDefault();
      event?.stopPropagation();
      await this.runBingHomeSearch(embed, input, resultHost);
    };

    form.addEventListener("submit", (event) => {
      runAsync(() => runSearch(event));
    }, true);
    submit?.addEventListener("click", (event) => {
      runAsync(() => runSearch(event));
    }, true);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        void runSearch(event);
      }
    }, true);
  }

  renderSearchEmbed(embed: HTMLElement, query: string): void {
    embed.empty();
    embed.createDiv({ cls: "mwv-note-source", text: "Bing backend" });
    embed.createEl("h2", { text: query ? `Search: ${query}` : "Search" });
    const form = embed.createEl("form", { cls: "mwv-md-search" });
    const input = form.createEl("input", {
      value: query,
      attr: { type: "search", placeholder: this.tr("searchBing") }
    });
    const button = form.createEl("button", { text: this.tr("search"), attr: { type: "submit" } });
    form.addEventListener("submit", (event) => {
      runAsync(async () => {
      event.preventDefault();
      const next = DEFAULT_SEARCH.replace("{{query}}", encodeURIComponent(input.value.trim()));
      await this.openUrlInEmbed(embed, next);
      });
    });
    if (button) {
      button.addClass("mwv-md-button");
    }
    if (query) {
      const list = embed.createDiv({ cls: "mwv-md-results" });
      list.createEl("p", { text: this.tr("searching") });
      this.searchBing(query)
        .then((results) => {
          list.empty();
          for (const result of results) {
            const item = list.createDiv({ cls: "mwv-md-result" });
            item.createEl("a", { cls: "mwv-md-result-title", text: result.title, href: result.url, attr: { "data-mwv-open-url": result.url, title: result.url } });
            item.createDiv({ cls: "mwv-md-result-url", text: result.url });
            if (result.snippet) item.createDiv({ cls: "mwv-md-result-snippet", text: result.snippet });
          }
        })
        .catch(() => {
          list.empty();
          for (const result of fallbackSearchResults(query)) {
            const item = list.createDiv({ cls: "mwv-md-result" });
            item.createEl("a", { cls: "mwv-md-result-title", text: result.title, href: result.url, attr: { "data-mwv-open-url": result.url, title: result.url } });
            item.createDiv({ cls: "mwv-md-result-url", text: result.url });
            item.createDiv({ cls: "mwv-md-result-snippet", text: result.snippet });
          }
        });
    }
  }

  renderBrowserChrome(embed: HTMLElement, url: string, title: string): void {
    embed.querySelectorAll<HTMLElement>(":scope > .mwv-embed-tab-strip, :scope > .mwv-browser-chrome, :scope > .mwv-browser-status, :scope > .mwv-bookmarks-bar").forEach((node) => node.remove());
    embed.dataset.mwvCurrentTitle = title || hostName(url);
    const chrome = embed.createDiv({ cls: "mwv-browser-chrome" });
    const controls = chrome.createDiv({ cls: "mwv-browser-controls" });
    const actions = chrome.createDiv({ cls: "mwv-browser-actions" });
    const setMode = (mode: "note" | "web" | "split") => {
      this.setNoteBrowserEmbedMode(embed, mode);
    };
    const makeNavButton = (icon: string, label: string, onClick: () => void, disabled = false) => {
      const button = controls.createEl("button", {
        cls: "mwv-browser-nav",
        attr: { type: "button", title: label, "aria-label": label }
      });
      button.disabled = disabled;
      setIcon(button, icon);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!button.disabled) onClick();
      });
      return button;
    };
    const makeModeButton = (icon: string, label: string, mode: "note" | "web" | "split") => {
      const button = actions.createEl("button", {
        cls: "mwv-browser-action mwv-browser-mode",
        attr: { type: "button", title: label, "aria-label": label }
      });
      button.dataset.mwvEmbedMode = mode;
      setIcon(button, icon);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setMode(mode);
      });
      return button;
    };

    makeNavButton("arrow-left", this.tr("back"), () => void this.navigateEmbedBack(embed), this.getEmbedStack(embed, "mwvBack").length === 0);
    makeNavButton("arrow-right", this.tr("forward"), () => void this.navigateEmbedForward(embed), this.getEmbedStack(embed, "mwvForward").length === 0);
    makeNavButton("rotate-cw", this.tr("reload"), () => void this.refreshEmbed(embed));
    makeModeButton("file-text", this.tr("note"), "note");
    makeModeButton("globe-2", this.tr("web"), "web");
    const save = actions.createEl("button", {
      cls: "mwv-browser-action",
      attr: { type: "button", title: this.tr("saveMd"), "aria-label": this.tr("saveMd") }
    });
    setIcon(save, "file-down");
    save.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.exportEmbedWebNote(embed);
    });
    const more = actions.createEl("button", {
      cls: "mwv-browser-action mwv-browser-more",
      attr: {
        type: "button",
        title: this.tr("more"),
        "aria-label": this.tr("more")
      }
    });
    more.dataset.mwvUrl = url;
    more.dataset.mwvTitle = title;
    setIcon(more, "more-horizontal");
    more.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const liveUrl = more.dataset.mwvUrl || embed.dataset.url || url;
      const liveTitle =
        more.dataset.mwvTitle ||
        this.getEmbedSurfaceTitle(embed) ||
        title ||
        hostName(liveUrl);
      this.toggleMorePanel(embed, chrome, liveUrl, liveTitle);
    });

    const address = chrome.createEl("form", {
      cls: "mwv-browser-address",
      attr: { title: url }
    });
    const home = address.createEl("button", {
      cls: "mwv-browser-home",
      attr: { type: "button", title: this.tr("home"), "aria-label": this.tr("home") }
    });
    setIcon(home, "home");
    home.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.openUrlInEmbed(embed, this.settings.homeUrl);
    });
    const addressInput = address.createEl("input", {
      cls: "mwv-browser-url",
      value: url,
      attr: {
        type: "text",
        inputmode: "url",
        autocomplete: "off",
        autocapitalize: "off",
        spellcheck: "false",
        "aria-label": this.tr("address")
      }
    });
    const go = address.createEl("button", {
      cls: "mwv-browser-go",
      attr: { type: "submit", title: this.tr("go"), "aria-label": this.tr("go") }
    });
    setIcon(go, "arrow-right");
    address.addEventListener("submit", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.openUrlInEmbed(embed, addressInput.value);
    });

    this.renderBookmarksBar(embed);
    const initialMode = ["note", "web", "split"].includes(embed.dataset.mwvBrowserMode ?? "")
      ? embed.dataset.mwvBrowserMode as "note" | "web" | "split"
      : "note";
    setMode(initialMode || "note");
    this.watchEmbedChrome(embed);
    this.syncNoteBrowserNativeIdentity(embed, url);
  }

  watchEmbedChrome(embed: HTMLElement): void {
    const state = embed as MobileWebviewerEmbedElement;
    state._mwvChromeObserver?.disconnect();
    if (state._mwvChromeWatchTimer) window.clearTimeout(state._mwvChromeWatchTimer);
    if (state._mwvChromeHeartbeatTimer) window.clearInterval(state._mwvChromeHeartbeatTimer);
    const schedule = () => {
      if (state._mwvChromeWatchTimer) window.clearTimeout(state._mwvChromeWatchTimer);
      state._mwvChromeWatchTimer = window.setTimeout(() => {
        state._mwvChromeWatchTimer = undefined;
        this.ensureEmbedChrome(embed);
      }, 80);
    };
    state._mwvChromeObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== "childList") continue;
        const touchedChrome = Array.from(mutation.removedNodes).some((node) =>
          isHtmlElement(node) &&
          (node.hasClass("mwv-browser-chrome") || Boolean(node.querySelector?.(".mwv-browser-chrome")))
        );
        const missingChrome = !embed.querySelector(":scope > .mwv-browser-chrome");
        if (touchedChrome || missingChrome) {
          schedule();
          break;
        }
      }
    });
    state._mwvChromeObserver.observe(embed, { childList: true });
    state._mwvChromeHeartbeatTimer = window.setInterval(() => {
      if (!embed.isConnected) {
        if (state._mwvChromeHeartbeatTimer) window.clearInterval(state._mwvChromeHeartbeatTimer);
        state._mwvChromeHeartbeatTimer = undefined;
        state._mwvChromeObserver?.disconnect();
        state._mwvChromeObserver = undefined;
        return;
      }
      this.ensureEmbedChrome(embed);
    }, 1200);
    this.register(() => {
      state._mwvChromeObserver?.disconnect();
      if (state._mwvChromeWatchTimer) window.clearTimeout(state._mwvChromeWatchTimer);
      if (state._mwvChromeHeartbeatTimer) window.clearInterval(state._mwvChromeHeartbeatTimer);
      state._mwvChromeWatchTimer = undefined;
      state._mwvChromeHeartbeatTimer = undefined;
      state._mwvChromeObserver = undefined;
    });
    schedule();
  }

  ensureEmbedChrome(embed: HTMLElement): void {
    if (!embed.isConnected || (!embed.hasClass("mwv-note-embed") && !embed.hasClass("mwv-bing-home") && !embed.hasClass("mwv-utility-embed"))) return;
    const url = embed.dataset.url || this.settings.noteBrowserUrl || this.settings.homeUrl;
    const title = embed.dataset.mwvCurrentTitle || this.getEmbedSurfaceTitle(embed) || hostName(url);
    const chrome = embed.querySelector<HTMLElement>(":scope > .mwv-browser-chrome");
    if (chrome?.querySelector(".mwv-browser-more")) {
      this.updateEmbedChrome(embed, url, title);
      this.pinEmbedChrome(embed);
      return;
    }
    const scrollTop = embed.scrollTop;
    this.renderBrowserChrome(embed, url, title);
    this.pinEmbedChrome(embed);
    embed.scrollTop = scrollTop;
    void this.addConsole("warn", "NoteWeb navigation toolbar restored", url);
  }

  pinEmbedChrome(embed: HTMLElement): void {
    const nodes = [
      embed.querySelector<HTMLElement>(":scope > .mwv-browser-chrome"),
      embed.querySelector<HTMLElement>(":scope > .mwv-bookmarks-bar")
    ].filter((node): node is HTMLElement => Boolean(node));
    let anchor: ChildNode | null = embed.firstChild;
    for (const node of nodes) {
      if (anchor === node) {
        anchor = node.nextSibling;
        continue;
      }
      embed.insertBefore(node, anchor);
      anchor = node.nextSibling;
    }
  }

  async openEmbedInBrowserView(embed: HTMLElement): Promise<void> {
    const panel = embed.querySelector<WebNotePanelElement>(".mwv-reader-panel");
    await panel?._mwvFlushWebNote?.();
    const url = panel?.dataset.url || embed.dataset.url || this.settings.noteBrowserUrl || this.settings.homeUrl;
    await this.activateBrowserView(url);
  }

  async exportEmbedWebNote(embed: HTMLElement): Promise<void> {
    const panel = embed.querySelector<WebNotePanelElement>(".mwv-reader-panel");
    if (!panel) {
      new Notice(this.tr("readerNoteNotReady"));
      return;
    }
    await panel._mwvFlushWebNote?.();
    const url = panel.dataset.url || embed.dataset.url || this.settings.noteBrowserUrl || this.settings.homeUrl;
    const note = this.settings.webNotes.find((entry) => entry.id === webNoteId(url) || entry.url === url);
    if (!note) {
      new Notice(this.tr("noWebNoteToExport"));
      return;
    }
    const exported = await this.exportWebNoteMarkdown(note);
    panel.querySelector<HTMLElement>(".mwv-webnote-status")?.setText("");
    new Notice(this.tr("savedTo", { path: exported.markdownPath }));
  }

  toggleMorePanel(embed: HTMLElement, chrome: HTMLElement, url: string, title: string): void {
    const existing = embed.querySelector<HTMLElement>(".mwv-extension-panel");
    if (existing) {
      existing.remove();
      return;
    }

    const panel = embed.createDiv({ cls: "mwv-extension-panel" });
    const activeScripts = this.getActiveUserScriptRules(url);
    const head = panel.createDiv({ cls: "mwv-more-head" });
    head.createDiv({ cls: "mwv-extension-title", text: this.tr("more") });
    const close = head.createEl("button", { cls: "mwv-more-close", attr: { type: "button", "aria-label": this.tr("closeMore") } });
    setIcon(close, "x");
    close.addEventListener("click", () => panel.remove());
    const body = panel.createDiv({ cls: "mwv-more-body" });
    const feedback = body.createDiv({
      cls: "mwv-more-feedback",
      text: this.tr("downloadSavedTo", { folder: this.normalizeDownloadFolder() })
    });
    const sections = body.createDiv({ cls: "mwv-more-sections" });
    const setFeedback = (message: string, isError = false) => {
      feedback.setText(message);
      feedback.toggleClass("is-error", isError);
    };
    const addGroup = (title: string): HTMLElement => {
      const section = sections.createDiv({ cls: "mwv-more-section" });
      section.createDiv({ cls: "mwv-more-section-title", text: title });
      return section.createDiv({ cls: "mwv-more-actions" });
    };
    const tabActions = addGroup(this.tr("tabs"));
    const pageActions = addGroup(this.tr("page"));
    const viewActions = addGroup(this.tr("view"));
    const saveActions = addGroup(this.tr("save"));
    const toolActions = addGroup(this.tr("tools"));
    const addAction = (
      group: HTMLElement,
      icon: string,
      label: string,
      onClick: () => void | Promise<void>,
      closePanel = false
    ): HTMLButtonElement => {
      const button = group.createEl("button", { cls: "mwv-more-action", attr: { type: "button", title: label } });
      setIcon(button, icon);
      button.createSpan({ text: label });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.disabled = true;
        setFeedback(this.tr("runningAction", { label }));
        runActionWithFeedback(
          onClick,
          () => {
            setFeedback(this.tr("completedAction", { label }));
            if (closePanel) panel.remove();
          },
          (error) => {
            const message = error instanceof Error ? error.message : String(error);
            setFeedback(this.tr("failedAction", { label, message }), true);
            void this.addConsole("error", `${label} failed: ${message}`, url);
            new Notice(`${label} failed`);
          },
          () => {
            button.disabled = false;
          }
        );
      });
      return button;
    };

    addAction(tabActions, "download", this.tr("downloadsCount", { count: this.settings.downloads.length }), () => void this.newEmbedBrowserTab(embed, utilityPageUrl("downloads")), true);
    addAction(tabActions, "history", this.tr("historyCount", { count: this.settings.history.length }), () => void this.newEmbedBrowserTab(embed, utilityPageUrl("history")), true);
    addAction(tabActions, "book-open", this.tr("bookmarksCount", { count: this.settings.bookmarks.length }), () => void this.newEmbedBrowserTab(embed, utilityPageUrl("bookmarks")), true);
    addAction(tabActions, "library", this.tr("readingCount", { count: this.settings.readingList.length }), () => void this.newEmbedBrowserTab(embed, utilityPageUrl("reading")), true);
    addAction(tabActions, "terminal", this.tr("consoleCount", { count: this.settings.consoleEntries.length }), () => void this.newEmbedBrowserTab(embed, utilityPageUrl("console")), true);
    addAction(tabActions, "bot", this.tr("cancipAi"), () => void this.newEmbedBrowserTab(embed, utilityPageUrl("cancip", url)), true);

    addAction(pageActions, "external-link", this.tr("openInBrowser"), () => {
      void this.openNoteBrowser(url, true);
    });
    addAction(pageActions, "copy", this.tr("copyLink"), async () => {
      await navigator.clipboard.writeText(`[${title}](${url})`);
      new Notice(this.tr("copiedLink"));
    });
    addAction(pageActions, "share-2", this.tr("share"), async () => {
      await this.sharePage(url, title || hostName(url));
    });
    addAction(pageActions, "app-window", this.tr("systemBrowser"), () => {
      this.openInSystemBrowser(url);
    });
    addAction(pageActions, "cookie", this.tr("clearCookies"), async () => {
      await this.clearProxyCookies();
      new Notice(this.tr("cookiesCleared"));
    });
    addAction(pageActions, "activity", this.tr("browserStatus"), () => {
      this.toggleEmbedBrowserStatusPanel(body, embed, url);
    }, false);

    addAction(viewActions, "zoom-in", this.tr("zoomIn", { value: this.settings.pageZoom }), async () => {
      await this.setPageZoom(this.settings.pageZoom + 10, embed);
    }, false);
    addAction(viewActions, "zoom-out", this.tr("zoomOut"), async () => {
      await this.setPageZoom(this.settings.pageZoom - 10, embed);
    }, false);
    addAction(viewActions, "monitor-smartphone", this.settings.desktopMode ? this.tr("mobileVersion") : this.tr("desktopVersion"), async () => {
      await this.toggleDesktopMode(embed);
    }, false);
    addAction(viewActions, "moon", this.settings.nightMode ? this.tr("dayMode") : this.tr("nightMode"), async () => {
      await this.toggleBooleanMode("nightMode", embed, "Night mode");
    }, false);
    addAction(viewActions, "eye", this.settings.eyeProtectionMode ? this.tr("closeEyeProtection") : this.tr("eyeProtection"), async () => {
      await this.toggleBooleanMode("eyeProtectionMode", embed, "Eye mode");
    }, false);
    addAction(viewActions, "shield-check", this.settings.adBlockEnabled ? this.tr("closeAdBlock") : this.tr("adBlocking"), async () => {
      await this.setAdMode(!this.settings.adBlockEnabled, false, embed);
      await this.refreshEmbed(embed);
    }, false);
    addAction(viewActions, "scan", this.settings.markAdsEnabled ? this.tr("unmarkAds") : this.tr("markAds"), async () => {
      await this.setAdMode(false, !this.settings.markAdsEnabled, embed);
      await this.refreshEmbed(embed);
    }, false);
    addAction(viewActions, "glasses", this.settings.incognitoMode ? this.tr("closeIncognito") : this.tr("incognito"), async () => {
      await this.toggleBooleanMode("incognitoMode", embed, "Incognito");
    }, false);
    addAction(viewActions, "maximize", this.settings.fullScreenMode ? this.tr("exitFullscreen") : this.tr("fullscreen"), async () => {
      await this.toggleFullscreen(embed);
    }, false);
    addAction(viewActions, "file-x", this.settings.jsDisabled ? this.tr("enableJs") : this.tr("disableJs"), async () => {
      await this.toggleBooleanMode("jsDisabled", embed, "JavaScript");
      await this.refreshEmbed(embed);
    }, false);
    addAction(viewActions, "smartphone", `UA: ${this.settings.userAgentMode}`, async () => {
      await this.toggleUserAgent(embed);
      await this.refreshEmbed(embed);
    }, false);
    addAction(viewActions, "rotate-cw", this.settings.rotatedMode ? this.tr("closeLandscape") : this.tr("landscape"), async () => {
      await this.toggleBooleanMode("rotatedMode", embed, "Rotate");
    }, false);
    addAction(viewActions, "type", this.tr("fontSize", { value: this.settings.readerFontScale }), async () => {
      await this.adjustReaderFont(10, embed);
    }, false);

    addAction(saveActions, "download", this.tr("downloadFile"), async () => {
      await this.downloadUrlFile(url);
      await this.newEmbedBrowserTab(embed, utilityPageUrl("downloads"));
    }, true);
    addAction(saveActions, "file-code", this.tr("saveHtml"), async () => {
      await this.downloadCurrentPageHtml(url, title || hostName(url));
      await this.newEmbedBrowserTab(embed, utilityPageUrl("downloads"));
    }, true);
    addAction(saveActions, "archive", this.tr("saveMht"), async () => {
      await this.downloadCurrentPageMhtml(url, title || hostName(url));
      await this.newEmbedBrowserTab(embed, utilityPageUrl("downloads"));
    }, true);
    addAction(saveActions, "file-down", this.tr("offlinePage"), async () => {
      await this.saveOfflinePage(url, title || hostName(url));
      await this.newEmbedBrowserTab(embed, utilityPageUrl("downloads"));
    }, true);
    addAction(saveActions, "file-symlink", this.tr("desktopShortcut"), async () => {
      const path = await this.createShortcutFile(url, title || hostName(url));
      this.toggleToolsPanel(body, this.tr("desktopShortcut"), [this.tr("saved", { path })]);
    }, false);
    addAction(
      saveActions,
      "star",
      this.settings.bookmarks.some((entry) => entry.url === url) ? this.tr("removeBookmark") : this.tr("addBookmark"),
      async () => {
        const added = await this.toggleBookmarkEntry(url, title || hostName(url));
        new Notice(added ? this.tr("bookmarkAdded") : this.tr("bookmarkRemoved"));
      }
    );
    addAction(saveActions, "book-open", this.tr("addReadingList"), async () => {
      await this.addReadingList({ title: title || hostName(url), url, time: Date.now() });
      new Notice(this.tr("addedReadingList"));
    });

    addAction(toolActions, "text-cursor-input", this.tr("autofillPage"), async () => {
      const frame = embed.querySelector<BrowserSurfaceElement>(".mwv-live-frame");
      if (!frame) return;
      const count = await this.autofillFrame(frame, url);
      if (count) new Notice(this.tr("completedAction", { label: this.tr("autofillPage") }));
    });
    addAction(toolActions, "wand-sparkles", this.tr("scriptsCount", { count: activeScripts.length }), () => {
      this.toggleUserScriptsPanel(body, url);
    }, false);
    addAction(toolActions, "settings", this.tr("siteSettings"), () => {
      this.toggleSiteSettingsPanel(body, url);
    }, false);
    addAction(toolActions, "radio", this.tr("mediaSniff"), () => {
      void this.toggleAssetsPanel(body, url, "media");
    }, false);
    addAction(toolActions, "layers", this.tr("pageAssets"), () => {
      void this.toggleAssetsPanel(body, url, "resources");
    }, false);
    addAction(toolActions, "code-2", this.tr("viewSource"), () => {
      void this.toggleSourcePanel(body, url);
    }, false);
    addAction(toolActions, "languages", this.tr("translateAction"), () => {
      this.toggleTranslatePanel(body, embed, url);
    }, false);
    addAction(toolActions, "volume-2", this.tr("readAloud"), async () => {
      await this.readPageAloud(url);
    }, false);
    addAction(toolActions, "qr-code", this.tr("qrCode"), () => {
      this.toggleQrPanel(body, url);
    }, false);
    addAction(toolActions, "shield-alert", this.tr("report"), () => {
      this.toggleReportPanel(body, url);
    }, false);
    addAction(toolActions, "briefcase", this.tr("toolStatus"), () => {
      this.toggleToolsPanel(body, this.tr("toolStatus"), [
        `Mode: ${this.settings.desktopMode ? this.tr("desktop") : this.tr("mobile")}`,
        `UA: ${this.settings.userAgentMode}`,
        `JavaScript: ${this.settings.jsDisabled ? this.tr("disabled") : this.tr("yes")}`,
        `${this.tr("adBlock")}: ${this.settings.adBlockEnabled ? this.tr("yes") : this.tr("no")}`
      ]);
    }, false);
    addAction(toolActions, "trash", this.tr("clearCache", { count: this.settings.pageCache.length }), async () => {
      await this.clearCache();
      this.toggleConsolePanel(body, url, this.tr("cacheCleared"));
    }, false);
    addAction(toolActions, "trash-2", this.tr("clearBrowsingDataAction"), async () => {
      await this.clearBrowsingData();
      this.toggleConsolePanel(body, url, this.tr("browsingDataCleared"));
    }, false);

    const enabled = body.createDiv({ cls: "mwv-extension-grid" });
    for (const item of [
      ["Live View", "On", "Direct page surface inside Note Browser."],
      ["Reader", "Auto", "Article text and media layer."],
      ["Cache", `${this.settings.pageCache.length}`, "Reader pages retained for faster internal display."],
      ["View Mode", this.settings.desktopMode ? "Desktop" : "Mobile", "Switches live page width and zoom surface."],
      ["Downloads", `${this.settings.downloads.length}`, "Files, HTML, and MHT saves inside the vault folder."],
      ["Autofill", "On", "Address suggestions and accessible form fill."],
      ["User Scripts", this.settings.userScriptsEnabled ? String(activeScripts.length) : "Off", "Matched reader CSS/JavaScript rules."],
      ["Reading List", `${this.settings.readingList.length}`, "Saved pages stay available from the browser bar."]
    ]) {
      const row = enabled.createDiv({ cls: "mwv-extension-row" });
      row.createDiv({ cls: "mwv-extension-name", text: item[0] });
      row.createDiv({ cls: "mwv-extension-state", text: item[1] });
      row.createDiv({ cls: "mwv-extension-desc", text: item[2] });
    }
    if (chrome.isConnected && chrome.parentElement === embed) {
      chrome.insertAdjacentElement("afterend", panel);
    } else {
      embed.appendChild(panel);
    }
  }

  renderBookmarksBar(embed: HTMLElement): void {
    const bar = embed.createDiv({ cls: "mwv-bookmarks-bar" });
    const visibleBookmarks = this.settings.bookmarks
      .filter((entry) => {
        const title = (entry.title || "").trim().toLowerCase();
        const url = entry.url.trim().toLowerCase().replace(/\/+$/, "");
        return !(
          (title === "bing" && /^https:\/\/(www\.)?bing\.com$/i.test(url)) ||
          (title === "wikipedia" && /^https:\/\/(www\.)?wikipedia\.org$/i.test(url))
        );
      })
      .slice(0, 8);
    const entries = uniqueEntries(
      [
        ...visibleBookmarks,
        ...this.settings.readingList.slice(0, 4)
      ],
      10
    );
    if (!entries.length) {
      bar.remove();
      return;
    }
    for (const entry of entries) {
      const button = bar.createEl("button", {
        cls: "mwv-bookmark-chip",
        attr: { type: "button", "data-mwv-open-url": entry.url, title: entry.url }
      });
      button.createSpan({ text: entry.title || hostName(entry.url) });
    }
  }

  toggleConsolePanel(panel: HTMLElement, url: string, message?: string): void {
    const existing = panel.querySelector<HTMLElement>(".mwv-console-panel");
    if (existing && !message) {
      existing.remove();
      return;
    }
    existing?.remove();
    const readingPanel = panel.querySelector<HTMLElement>(".mwv-reading-panel");
    readingPanel?.remove();
    const scriptPanel = panel.querySelector<HTMLElement>(".mwv-userscript-panel");
    scriptPanel?.remove();
    panel.querySelector<HTMLElement>(".mwv-history-panel")?.remove();
    panel.querySelector<HTMLElement>(".mwv-downloads-panel")?.remove();
    const consolePanel = panel.createDiv({ cls: "mwv-console-panel" });
    consolePanel.createDiv({ cls: "mwv-console-title", text: message ?? `${this.tr("console")} · ${hostName(url)}` });
    const entries = this.settings.consoleEntries.slice(0, 10);
    if (!entries.length) {
      consolePanel.createDiv({ cls: "mwv-console-empty", text: this.tr("emptyConsoleDesc") });
      return;
    }
    for (const entry of entries) {
      const row = consolePanel.createDiv({ cls: `mwv-console-row is-${entry.level}` });
      row.createDiv({ cls: "mwv-console-level", text: entry.level });
      row.createDiv({ cls: "mwv-console-message", text: entry.message });
    }
  }

  toggleReadingListPanel(panel: HTMLElement): void {
    const existing = panel.querySelector<HTMLElement>(".mwv-reading-panel");
    if (existing) {
      existing.remove();
      return;
    }
    const consolePanel = panel.querySelector<HTMLElement>(".mwv-console-panel");
    consolePanel?.remove();
    const scriptPanel = panel.querySelector<HTMLElement>(".mwv-userscript-panel");
    scriptPanel?.remove();
    panel.querySelector<HTMLElement>(".mwv-history-panel")?.remove();
    panel.querySelector<HTMLElement>(".mwv-downloads-panel")?.remove();
    const readingPanel = panel.createDiv({ cls: "mwv-reading-panel" });
    readingPanel.createDiv({ cls: "mwv-reading-title", text: this.tr("readingList") });
    const entries = this.settings.readingList.slice(0, 20);
    if (!entries.length) {
      readingPanel.createDiv({ cls: "mwv-reading-empty", text: this.tr("noSavedPages") });
      return;
    }
    for (const entry of entries) {
      const item = readingPanel.createEl("button", {
        cls: "mwv-reading-item",
        attr: { type: "button", "data-mwv-open-url": entry.url, title: entry.url }
      });
      item.createDiv({ cls: "mwv-reading-item-title", text: entry.title || hostName(entry.url) });
      item.createDiv({ cls: "mwv-reading-item-url", text: entry.url });
    }
  }

  toggleHistoryPanel(panel: HTMLElement): void {
    const existing = panel.querySelector<HTMLElement>(".mwv-history-panel");
    if (existing) {
      existing.remove();
      return;
    }
    panel.querySelector<HTMLElement>(".mwv-console-panel")?.remove();
    panel.querySelector<HTMLElement>(".mwv-reading-panel")?.remove();
    panel.querySelector<HTMLElement>(".mwv-userscript-panel")?.remove();
    panel.querySelector<HTMLElement>(".mwv-downloads-panel")?.remove();
    const historyPanel = panel.createDiv({ cls: "mwv-history-panel" });
    historyPanel.createDiv({ cls: "mwv-history-title", text: this.tr("history") });
    const entries = this.settings.history.slice(0, 30);
    if (!entries.length) {
      historyPanel.createDiv({ cls: "mwv-history-empty", text: this.tr("noHistoryYet") });
      return;
    }
    for (const entry of entries) {
      const item = historyPanel.createEl("button", {
        cls: "mwv-history-item",
        attr: { type: "button", "data-mwv-open-url": entry.url, title: entry.url }
      });
      item.createDiv({ cls: "mwv-history-item-title", text: entry.title || hostName(entry.url) });
      item.createDiv({ cls: "mwv-history-item-url", text: entry.url });
    }
  }

  toggleDownloadsPanel(panel: HTMLElement, message?: string): void {
    const existing = panel.querySelector<HTMLElement>(".mwv-downloads-panel");
    if (existing && !message) {
      existing.remove();
      return;
    }
    existing?.remove();
    panel.querySelector<HTMLElement>(".mwv-console-panel")?.remove();
    panel.querySelector<HTMLElement>(".mwv-reading-panel")?.remove();
    panel.querySelector<HTMLElement>(".mwv-userscript-panel")?.remove();
    panel.querySelector<HTMLElement>(".mwv-history-panel")?.remove();
    const downloadsPanel = panel.createDiv({ cls: "mwv-downloads-panel" });
    downloadsPanel.createDiv({ cls: "mwv-downloads-title", text: message ?? this.tr("downloads") });
    const entries = this.settings.downloads.slice(0, 20);
    if (!entries.length) {
      downloadsPanel.createDiv({ cls: "mwv-downloads-empty", text: this.tr("noDownloadsYet") });
      return;
    }
    for (const entry of entries) {
      const item = downloadsPanel.createDiv({ cls: `mwv-download-item is-${entry.status}` });
      const top = item.createDiv({ cls: "mwv-download-item-top" });
      top.createDiv({ cls: "mwv-download-item-title", text: entry.fileName || hostName(entry.url) });
      top.createDiv({ cls: "mwv-download-item-state", text: this.tr("downloadState", { status: entry.status, progress: Math.round(entry.progress) }) });
      const progress = item.createDiv({ cls: "mwv-download-progress" });
      progress.createDiv({ cls: "mwv-download-progress-fill", attr: { style: `width:${clampNumber(entry.progress, 0, 100)}%` } });
      item.createDiv({ cls: "mwv-download-item-meta", text: `${entry.connections} connection${entry.connections === 1 ? "" : "s"} · ${entry.resumable ? "Range" : "single"} · ${entry.format.toUpperCase()}` });
      item.createDiv({ cls: "mwv-download-item-path", text: entry.path || entry.message || entry.url });
      const row = item.createDiv({ cls: "mwv-download-list-actions" });
      const open = row.createEl("button", { cls: "mwv-mini-action", text: this.tr("openFile"), attr: { type: "button" } });
      open.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.openDownloadEntry(entry);
      });
      const copy = row.createEl("button", { cls: "mwv-mini-action", text: this.tr("copyPath"), attr: { type: "button" } });
      copy.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.copyDownloadPath(entry);
      });
      const locate = row.createEl("button", { cls: "mwv-mini-action", text: this.tr("location"), attr: { type: "button" } });
      locate.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.revealDownloadEntry(entry);
      });
    }
  }

  removeUtilityPanels(panel: HTMLElement): void {
    [
      ".mwv-console-panel",
      ".mwv-reading-panel",
      ".mwv-userscript-panel",
      ".mwv-history-panel",
      ".mwv-downloads-panel",
      ".mwv-site-panel",
      ".mwv-tools-panel",
      ".mwv-assets-panel",
      ".mwv-source-panel",
      ".mwv-qr-panel",
      ".mwv-report-panel",
      ".mwv-translate-panel"
    ].forEach((selector) => panel.querySelector<HTMLElement>(selector)?.remove());
  }

  toggleTranslatePanel(panel: HTMLElement, embed: HTMLElement, url: string): void {
    const existing = panel.querySelector<HTMLElement>(".mwv-translate-panel");
    if (existing) {
      existing.remove();
      return;
    }
    this.removeUtilityPanels(panel);
    const translatePanel = panel.createDiv({ cls: "mwv-translate-panel" });
    translatePanel.createDiv({ cls: "mwv-translate-title", text: this.tr("translatePage") });
    const grid = translatePanel.createDiv({ cls: "mwv-translate-grid" });
    for (const language of TRANSLATE_CHOICES) {
      const button = grid.createEl("button", {
        cls: language.code === this.settings.translateTarget ? "mwv-translate-lang is-active" : "mwv-translate-lang",
        attr: { type: "button" }
      });
      button.createDiv({ cls: "mwv-translate-native", text: language.native });
      button.createDiv({ cls: "mwv-translate-label", text: language.label });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        runAsync(async () => {
          this.settings.translateTarget = language.code;
          await this.saveSettings();
          await this.openUrlInEmbed(embed, buildTranslateUrl(url, language.code));
          panel.remove();
        });
      });
    }
  }

  toggleToolsPanel(panel: HTMLElement, title: string, rows: string[]): void {
    const existing = panel.querySelector<HTMLElement>(".mwv-tools-panel");
    if (existing) {
      existing.remove();
      return;
    }
    this.removeUtilityPanels(panel);
    const toolsPanel = panel.createDiv({ cls: "mwv-tools-panel" });
    toolsPanel.createDiv({ cls: "mwv-tools-title", text: title });
    for (const row of rows) {
      toolsPanel.createDiv({ cls: "mwv-tools-row", text: row });
    }
  }

  toggleEmbedBrowserStatusPanel(panel: HTMLElement, embed: HTMLElement, url: string): void {
    const existing = panel.querySelector<HTMLElement>(".mwv-tools-panel");
    if (existing) {
      existing.remove();
      return;
    }
    this.removeUtilityPanels(panel);
    const surface = embed.querySelector<BrowserSurfaceElement>(".mwv-live-frame");
    const toolsPanel = panel.createDiv({ cls: "mwv-tools-panel" });
    toolsPanel.createDiv({ cls: "mwv-tools-title", text: this.tr("browserStatus") });
    for (const row of this.describeBrowserSurface(surface ?? undefined, embed.dataset.url || url)) {
      toolsPanel.createDiv({ cls: "mwv-tools-row", text: row });
    }
  }

  toggleSiteSettingsPanel(panel: HTMLElement, url: string): void {
    const existing = panel.querySelector<HTMLElement>(".mwv-site-panel");
    if (existing) {
      existing.remove();
      return;
    }
    this.removeUtilityPanels(panel);
    const sitePanel = panel.createDiv({ cls: "mwv-site-panel" });
    sitePanel.createDiv({ cls: "mwv-site-title", text: `Site settings · ${hostName(url)}` });
    const rows = [
      ["JavaScript", this.settings.jsDisabled ? this.tr("disabled") : this.tr("yes")],
      [this.tr("adBlock"), this.settings.adBlockEnabled ? this.tr("yes") : this.settings.markAdsEnabled ? this.tr("markAds") : this.tr("no")],
      [this.tr("view"), this.settings.desktopMode ? this.tr("desktop") : this.tr("mobile")],
      ["UA", this.settings.userAgentMode],
      [this.tr("history"), this.settings.incognitoMode ? this.tr("incognito") : this.tr("savedPlugin")],
      [this.tr("fontSize", { value: this.settings.readerFontScale }), `${this.settings.readerFontScale}%`]
    ];
    for (const [name, value] of rows) {
      const row = sitePanel.createDiv({ cls: "mwv-site-row" });
      row.createDiv({ cls: "mwv-site-name", text: name });
      row.createDiv({ cls: "mwv-site-value", text: value });
    }
  }

  async toggleAssetsPanel(panel: HTMLElement, url: string, mode: "media" | "resources" | "developer"): Promise<void> {
    const existing = panel.querySelector<HTMLElement>(".mwv-assets-panel");
    if (existing) {
      existing.remove();
      return;
    }
    this.removeUtilityPanels(panel);
    const assetsPanel = panel.createDiv({ cls: "mwv-assets-panel" });
    const title = mode === "media" ? this.tr("mediaSniff") : mode === "developer" ? this.tr("tools") : this.tr("pageAssets");
    assetsPanel.createDiv({ cls: "mwv-assets-title", text: title });
    assetsPanel.createDiv({ cls: "mwv-assets-empty", text: this.tr("loading") });
    try {
      const assets = await this.extractPageAssets(url);
      assetsPanel.empty();
      assetsPanel.createDiv({ cls: "mwv-assets-title", text: title });
      const rows =
        mode === "media"
          ? assets.media
          : mode === "developer"
            ? [...assets.scripts.map((item) => `JS ${item}`), ...assets.styles.map((item) => `CSS ${item}`), `HTML ${assets.html.length} chars`]
            : [...assets.links.map((item) => `LINK ${item}`), ...assets.media.map((item) => `MEDIA ${item}`), ...assets.scripts.map((item) => `JS ${item}`), ...assets.styles.map((item) => `CSS ${item}`)];
      if (!rows.length) {
        assetsPanel.createDiv({ cls: "mwv-assets-empty", text: this.tr("noResourcesFound") });
      }
      for (const rowText of rows.slice(0, 60)) {
        const row = assetsPanel.createDiv({ cls: "mwv-assets-row" });
        row.createDiv({ cls: "mwv-assets-url", text: rowText });
      }
    } catch (error) {
      assetsPanel.empty();
      assetsPanel.createDiv({ cls: "mwv-assets-title", text: title });
      assetsPanel.createDiv({ cls: "mwv-assets-empty", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async toggleSourcePanel(panel: HTMLElement, url: string): Promise<void> {
    const existing = panel.querySelector<HTMLElement>(".mwv-source-panel");
    if (existing) {
      existing.remove();
      return;
    }
    this.removeUtilityPanels(panel);
    const sourcePanel = panel.createDiv({ cls: "mwv-source-panel" });
    sourcePanel.createDiv({ cls: "mwv-source-title", text: this.tr("pageSource") });
    sourcePanel.createDiv({ cls: "mwv-source-code", text: this.tr("loading") });
    try {
      const assets = await this.extractPageAssets(url);
      sourcePanel.empty();
      sourcePanel.createDiv({ cls: "mwv-source-title", text: this.tr("pageSource") });
      const copy = sourcePanel.createEl("button", { cls: "mwv-source-copy", text: this.tr("copySource"), attr: { type: "button" } });
      copy.addEventListener("click", () => runAsync(async () => {
        await navigator.clipboard.writeText(assets.html);
        new Notice(this.tr("sourceCopied"));
      }));
      sourcePanel.createDiv({ cls: "mwv-source-code", text: assets.html.slice(0, 12000) });
    } catch (error) {
      sourcePanel.empty();
      sourcePanel.createDiv({ cls: "mwv-source-title", text: this.tr("pageSource") });
      sourcePanel.createDiv({ cls: "mwv-source-code", text: error instanceof Error ? error.message : String(error) });
    }
  }

  toggleQrPanel(panel: HTMLElement, url: string): void {
    const existing = panel.querySelector<HTMLElement>(".mwv-qr-panel");
    if (existing) {
      existing.remove();
      return;
    }
    this.removeUtilityPanels(panel);
    const qrPanel = panel.createDiv({ cls: "mwv-qr-panel" });
    qrPanel.createDiv({ cls: "mwv-qr-title", text: this.tr("qrCode") });
    qrPanel.createEl("img", {
      cls: "mwv-qr-image",
      attr: {
        src: buildQrSvgDataUrl(url),
        alt: "QR code"
      }
    });
    qrPanel.createDiv({ cls: "mwv-qr-url", text: url });
    const copy = qrPanel.createEl("button", { cls: "mwv-source-copy", text: this.tr("copyLink"), attr: { type: "button" } });
    copy.addEventListener("click", () => runAsync(async () => {
      await navigator.clipboard.writeText(url);
      new Notice(this.tr("urlCopied"));
    }));
  }

  toggleReportPanel(panel: HTMLElement, url: string): void {
    const existing = panel.querySelector<HTMLElement>(".mwv-report-panel");
    if (existing) {
      existing.remove();
      return;
    }
    this.removeUtilityPanels(panel);
    const reportPanel = panel.createDiv({ cls: "mwv-report-panel" });
    reportPanel.createDiv({ cls: "mwv-report-title", text: this.tr("reportUrl") });
    reportPanel.createDiv({ cls: "mwv-report-row", text: hostName(url) });
    reportPanel.createDiv({ cls: "mwv-report-row", text: url });
    const copy = reportPanel.createEl("button", { cls: "mwv-source-copy", text: this.tr("copyReport"), attr: { type: "button" } });
    copy.addEventListener("click", () => runAsync(async () => {
      await navigator.clipboard.writeText(`Report URL\n${url}`);
      new Notice(this.tr("reportCopied"));
    }));
  }

  toggleUserScriptsPanel(panel: HTMLElement, url: string): void {
    const existing = panel.querySelector<HTMLElement>(".mwv-userscript-panel");
    if (existing) {
      existing.remove();
      return;
    }
    this.removeUtilityPanels(panel);
    const scriptsPanel = panel.createDiv({ cls: "mwv-userscript-panel" });
    const activeRules = this.getActiveUserScriptRules(url);
    scriptsPanel.createDiv({ cls: "mwv-userscript-title", text: `${this.tr("userScriptRules")} · ${hostName(url)}` });
    if (!this.settings.userScriptsEnabled) {
      scriptsPanel.createDiv({ cls: "mwv-userscript-empty", text: this.tr("disabled") });
      return;
    }
    if (!activeRules.length) {
      scriptsPanel.createDiv({ cls: "mwv-userscript-empty", text: this.tr("noMatchingScripts") });
      return;
    }
    for (const rule of activeRules) {
      const item = scriptsPanel.createDiv({ cls: "mwv-userscript-item" });
      item.createDiv({ cls: "mwv-userscript-name", text: rule.name || this.tr("ruleName") });
      item.createDiv({ cls: "mwv-userscript-match", text: rule.match || "*://*/*" });
      const state = item.createDiv({ cls: "mwv-userscript-state" });
      state.createSpan({ text: rule.css.trim() ? "CSS" : `${this.tr("no")} CSS` });
      state.createSpan({ text: rule.js.trim() ? "JS" : `${this.tr("no")} JS` });
    }
  }

  toggleEmbedFindPanel(embed: HTMLElement): void {
    const existing = embed.querySelector<HTMLElement>(":scope > .mwv-find-panel");
    if (existing) {
      existing.remove();
      this.clearFindMarks(embed);
      return;
    }

    const chrome = embed.querySelector<HTMLElement>(".mwv-browser-chrome");
    const panel = embed.ownerDocument.createElement("div");
    panel.addClass("mwv-find-panel");
    const input = panel.createEl("input", {
      cls: "mwv-find-input",
      attr: { type: "search", placeholder: this.tr("findInPage"), autocomplete: "off" }
    });
    const prev = panel.createEl("button", { cls: "mwv-find-button", attr: { type: "button", title: this.tr("previous") } });
    setIcon(prev, "chevron-up");
    const next = panel.createEl("button", { cls: "mwv-find-button", attr: { type: "button", title: this.tr("next") } });
    setIcon(next, "chevron-down");
    const close = panel.createEl("button", { cls: "mwv-find-button", attr: { type: "button", title: this.tr("close") } });
    setIcon(close, "x");
    const status = panel.createDiv({ cls: "mwv-find-status", text: "0" });
    if (chrome) {
      chrome.insertAdjacentElement("afterend", panel);
    } else {
      embed.prepend(panel);
    }

    const run = async (direction = 1) => {
      const frame = embed.querySelector<BrowserSurfaceElement>(".mwv-live-frame");
      const count = await this.findInTargets(input.value.trim(), embed, frame ?? undefined, direction);
      status.setText(input.value.trim() ? String(count) : "0");
    };
    input.addEventListener("input", () => void run(1));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void run(event.shiftKey ? -1 : 1);
      }
    });
    prev.addEventListener("click", () => void run(-1));
    next.addEventListener("click", () => void run(1));
    close.addEventListener("click", () => {
      panel.remove();
      this.clearFindMarks(embed);
    });
    input.focus();
  }

  renderPageEmbed(embed: HTMLElement, page: NotePage): void {
    const retainedLiveBrowser = embed.querySelector<HTMLElement>(":scope > .mwv-live-browser");
    if (retainedLiveBrowser?.querySelector(":scope > .mwv-live-frame")) {
      Array.from(embed.children).forEach((child) => {
        if (child !== retainedLiveBrowser) child.remove();
      });
    } else {
      embed.empty();
    }
    embed.addClass("mwv-embed");
    embed.addClass("mwv-note-embed");
    embed.dataset.url = page.url;
    embed.setAttribute("data-url", page.url);
    embed.removeClass("mwv-bing-home");
    this.renderBrowserChrome(embed, page.url, page.title || hostName(page.url));
    if (retainedLiveBrowser) {
      const retainedFrame = retainedLiveBrowser.querySelector<BrowserSurfaceElement>(":scope > .mwv-live-frame");
      if (retainedFrame && !this.sameWebPage(this.safeBrowserSurfaceUrl(retainedFrame), page.url)) {
        this.setBrowserSurfaceUrl(retainedFrame, page.url);
      }
    }
    embed.createDiv({ cls: "mwv-note-source", text: page.byline || hostName(page.url) });
    embed.createEl("h2", { cls: "mwv-page-title", text: page.title || hostName(page.url) });
    if (page.images.length) {
      const media = embed.createDiv({ cls: "mwv-page-media" });
      for (const image of page.images.slice(0, 4)) {
        media.createEl("img", { attr: { src: image, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" } });
      }
    }
    const content = embed.createDiv({ cls: "mwv-md-content" });
    const blocks = page.content.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    const visibleBlocks = blocks.length ? blocks : [page.excerpt].filter(Boolean);
    for (const block of visibleBlocks.slice(0, 80)) {
      const clean = block.replace(/^#{1,3}\s+/, "");
      if (clean) content.createEl("p", { text: clean });
    }
    if (!visibleBlocks.length) {
      content.createEl("iframe", {
        cls: "mwv-reader-frame",
        attr: {
          src: page.url,
          title: page.title || hostName(page.url),
          sandbox: "allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-top-navigation-by-user-activation",
          referrerpolicy: "strict-origin-when-cross-origin"
        }
      });
    }
    if (page.links.length) {
      const links = embed.createDiv({ cls: "mwv-page-links" });
      links.createEl("h3", { text: this.tr("links") });
      for (const link of page.links.slice(0, 8)) {
        const item = links.createEl("button", {
          cls: "mwv-page-link",
          attr: { type: "button", "data-mwv-open-url": link.url, title: link.url }
        });
        item.createDiv({ cls: "mwv-page-link-title", text: link.title });
        item.createDiv({ cls: "mwv-page-link-url", text: link.url });
      }
    }
  }

  isBingHome(url: string): boolean {
    try {
      const parsed = new URL(url);
      return /(^|\.)bing\.com$/i.test(parsed.hostname) && !parsed.pathname.startsWith("/search");
    } catch {
      return false;
    }
  }

  extractBingQuery(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (/(^|\.)bing\.com$/i.test(parsed.hostname) && parsed.pathname.startsWith("/search")) {
        return parsed.searchParams.get("q") ?? "";
      }
      return null;
    } catch {
      return null;
    }
  }

  createBrowserTab(url = this.settings.homeUrl): BrowserTab {
    const nextUrl = normalizeInput(url || this.settings.homeUrl, this.settings.searchUrl);
    const utilityKind = internalUtilityKind(nextUrl);
    return {
      id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: utilityKind ? utilityPageTitle(utilityKind) : this.extractBingQuery(nextUrl) ? "Bing" : hostName(nextUrl),
      url: nextUrl,
      back: [],
      forward: [],
      time: Date.now()
    };
  }

  ensureBrowserTab(id = this.settings.activeBrowserTabId): BrowserTab {
    const validTabs = (this.settings.browserTabs ?? []).filter((tab) => tab?.id && tab?.url);
    this.settings.browserTabs = validTabs.slice(0, MAX_BROWSER_TABS);
    let tab = this.settings.browserTabs.find((item) => item.id === id);
    if (!tab) {
      tab = this.settings.browserTabs[0] ?? this.createBrowserTab(this.settings.homeUrl);
      if (!this.settings.browserTabs.length) this.settings.browserTabs = [tab];
    }
    this.settings.activeBrowserTabId = tab.id;
    return tab;
  }

  async updateBrowserTab(id: string, patch: Partial<Omit<BrowserTab, "id">>): Promise<void> {
    const tab = this.settings.browserTabs.find((item) => item.id === id);
    if (!tab) return;
    Object.assign(tab, patch);
    this.settings.browserTabs = [
      tab,
      ...this.settings.browserTabs.filter((item) => item.id !== id)
    ].slice(0, MAX_BROWSER_TABS);
    await this.saveSettings();
  }

  async addHistory(entry: WebEntry): Promise<void> {
    if (this.settings.incognitoMode) return;
    this.settings.history.unshift(entry);
    this.settings.history = uniqueEntries(this.settings.history, MAX_HISTORY);
    await this.saveSettings();
  }

  async toggleBookmarkEntry(url: string, title: string): Promise<boolean> {
    const exists = this.settings.bookmarks.some((entry) => entry.url === url);
    if (exists) {
      this.settings.bookmarks = this.settings.bookmarks.filter((entry) => entry.url !== url);
      await this.saveSettings();
      return false;
    }

    this.settings.bookmarks.unshift({
      title: title || hostName(url),
      url,
      time: Date.now()
    });
    this.settings.bookmarks = uniqueEntries(this.settings.bookmarks, MAX_BOOKMARKS);
    await this.saveSettings();
    return true;
  }

  async addReadingList(entry: WebEntry): Promise<void> {
    this.settings.readingList.unshift({
      title: entry.title || hostName(entry.url),
      url: entry.url,
      time: entry.time || Date.now()
    });
    this.settings.readingList = uniqueEntries(this.settings.readingList, MAX_READING_LIST);
    await this.saveSettings();
  }

  getCachedPage(url: string): NotePage | null {
    const entry = this.settings.pageCache.find((item) => item.url === url);
    if (!entry) return null;
    return {
      title: entry.title,
      url: entry.url,
      byline: entry.byline,
      content: entry.content,
      excerpt: entry.excerpt,
      images: Array.isArray(entry.images) ? [...entry.images] : [],
      links: Array.isArray(entry.links) ? [...entry.links] : []
    };
  }

  async rememberPageCache(page: NotePage): Promise<void> {
    if (this.settings.incognitoMode) return;
    this.settings.pageCache = this.settings.pageCache.filter((entry) => entry.url !== page.url);
    this.settings.pageCache.unshift({
      ...page,
      images: [...page.images],
      links: [...page.links],
      cachedAt: Date.now()
    });
    this.settings.pageCache = this.settings.pageCache.slice(0, MAX_CACHE_ENTRIES);
    await this.saveSettings();
  }

  async clearCache(): Promise<void> {
    this.settings.pageCache = [];
    await this.addConsole("info", "Cache cleared");
    await this.saveSettings();
  }

  createWebNoteFromPage(page: NotePage): WebNoteEntry {
    const now = Date.now();
    return {
      id: webNoteId(page.url),
      url: page.url,
      title: page.title || hostName(page.url),
      sourceTitle: page.title || hostName(page.url),
      noteHtml: "",
      noteText: page.content || page.excerpt || "",
      doodleSvg: "",
      pageHtml: "",
      pageText: "",
      pageEdits: [],
      markdownPath: "",
      updatedAt: now,
      createdAt: now
    };
  }

  async ensureWebNote(page: NotePage): Promise<WebNoteEntry> {
    const id = webNoteId(page.url);
    const existing = this.settings.webNotes.find((entry) => entry.id === id || entry.url === page.url);
    if (existing) {
      return existing;
    }
    const note = this.createWebNoteFromPage(page);
    note.noteHtml = this.notePageToHtml(page);
    note.noteText = page.content || page.excerpt || "";
    return await this.saveWebNote(note);
  }

  notePageToHtml(page: NotePage): string {
    const temp = createHostDiv();
    const blocks = page.content.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    for (const block of blocks.slice(0, 100)) {
      if (/^#{1,3}\s+/.test(block)) {
        const level = Math.min(3, block.match(/^#+/)?.[0].length ?? 2);
        temp.createEl(`h${level}` as keyof HTMLElementTagNameMap, { text: block.replace(/^#{1,3}\s+/, "") });
      } else {
        temp.createEl("p", { text: block });
      }
    }
    if (!blocks.length && page.excerpt) {
      temp.createEl("p", { text: page.excerpt });
    }
    return temp.innerHTML;
  }

  async saveWebNote(entry: WebNoteEntry): Promise<WebNoteEntry> {
    const saved: WebNoteEntry = {
      ...entry,
      updatedAt: Date.now()
    };
    this.settings.webNotes = [
      saved,
      ...this.settings.webNotes.filter((item) => item.id !== saved.id && item.url !== saved.url)
    ].slice(0, MAX_WEB_NOTES);
    await this.saveSettings();
    return saved;
  }

  async saveBrowserSurfaceWebNotePatch(patch: BrowserWebNotePatch): Promise<WebNoteEntry | undefined> {
    const url = normalizeInput(patch.url || "", this.settings.searchUrl);
    if (!url || isInternalUtilityUrl(url)) return undefined;
    const existing = this.settings.webNotes.find((entry) => entry.id === webNoteId(url) || entry.url === url);
    const hasNotePatch = patch.noteEdited === true || Boolean(patch.noteHtml || patch.noteText);
    const hasDoodlePatch = patch.doodleEdited === true || Boolean(patch.doodleSvg?.trim());
    const hasPagePatch = patch.pageEdited === true || Boolean(patch.pageHtml?.trim() || patch.pageText?.trim() || patch.webEdit);
    const base = existing ?? this.createWebNoteFromPage({
      title: patch.title || hostName(url),
      url,
      byline: hostName(url),
      excerpt: patch.noteText?.slice(0, 420) || "",
      content: patch.noteText || "",
      images: [],
      links: []
    });
    const saved = await this.saveWebNote({
      ...base,
      title: patch.title || base.title || hostName(url),
      sourceTitle: patch.title || base.sourceTitle || base.title,
      noteHtml: hasNotePatch && typeof patch.noteHtml === "string" ? patch.noteHtml : base.noteHtml,
      noteText: hasNotePatch && typeof patch.noteText === "string" ? patch.noteText : base.noteText,
      doodleSvg: hasDoodlePatch && typeof patch.doodleSvg === "string" ? patch.doodleSvg : base.doodleSvg,
      pageHtml: hasPagePatch && typeof patch.pageHtml === "string" ? patch.pageHtml : base.pageHtml,
      pageText: hasPagePatch && typeof patch.pageText === "string" ? patch.pageText : base.pageText,
      pageEdits: patch.webEdit
        ? normalizeBrowserWebTextEdits([...(base.pageEdits ?? []), patch.webEdit])
        : normalizeBrowserWebTextEdits(base.pageEdits),
      updatedAt: Date.now()
    });
    await this.addConsole("info", "Browser page note saved", url);
    return saved;
  }

  async exportWebNoteMarkdown(entry: WebNoteEntry): Promise<WebNoteEntry> {
    const folder = normalizePath(this.settings.webNoteFolder || DEFAULT_WEB_NOTE_FOLDER);
    await this.ensureVaultFolder(folder);
    const fileName = appendFileExtension(sanitizeFileName(entry.title || hostName(entry.url), "web-note"), "md");
    const path = entry.markdownPath || await this.uniqueVaultPath(folder, fileName);
    const saved = await this.saveWebNote({
      ...entry,
      markdownPath: path,
      updatedAt: Date.now()
    });
    await this.app.vault.adapter.write(path, webNoteMarkdown(saved));
    await this.addConsole("info", `Web note exported to Markdown: ${path}`, saved.url);
    return saved;
  }

  createPortableExport(): MobileWebviewerPortableData {
    const settings: Partial<MobileWebviewerSettings> = {};
    for (const key of PORTABLE_SETTING_KEYS) {
      (settings as Record<string, unknown>)[key] = this.settings[key];
    }
    return {
      type: "mobile-webviewer-data",
      version: this.manifest.version,
      exportedAt: new Date().toISOString(),
      settings,
      bookmarks: this.settings.bookmarks.filter((entry) => !isBuiltInShortcut(entry)),
      readingList: this.settings.readingList,
      history: this.settings.history,
      downloads: this.settings.downloads,
      userScriptRules: this.settings.userScriptRules,
      webNotes: this.settings.webNotes
    };
  }

  async copyPortableExport(): Promise<void> {
    const text = JSON.stringify(this.createPortableExport(), null, 2);
    await navigator.clipboard.writeText(text);
    new Notice(this.tr("jsonCopied"));
    await this.addConsole("info", "Portable export copied");
  }

  async savePortableExportFile(): Promise<string> {
    const folder = this.normalizeDownloadFolder();
    await this.ensureVaultFolder(folder);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = await this.uniqueVaultPath(folder, `mobile-webviewer-export-${stamp}.json`);
    await this.app.vault.adapter.write(path, JSON.stringify(this.createPortableExport(), null, 2));
    await this.addConsole("info", `Portable export saved: ${path}`);
    new Notice(this.tr("saved", { path }));
    return path;
  }

  async importPortableDataText(text: string): Promise<{ bookmarks: number; scripts: number; notes: number }> {
    const payload = parsePortableImportText(text);
    const importSettings = payload.settings ?? {};
    for (const key of PORTABLE_SETTING_KEYS) {
      if (Object.prototype.hasOwnProperty.call(importSettings, key)) {
        (this.settings as unknown as Record<string, unknown>)[key] = (importSettings as Record<string, unknown>)[key];
      }
    }
    this.settings.bookmarks = mergeWebEntries(this.settings.bookmarks, payload.bookmarks, MAX_BOOKMARKS);
    this.settings.readingList = mergeWebEntries(this.settings.readingList, payload.readingList, MAX_READING_LIST);
    this.settings.history = mergeWebEntries(this.settings.history, payload.history, MAX_HISTORY);
    this.settings.downloads = mergeDownloads(this.settings.downloads, payload.downloads);
    this.settings.userScriptRules = mergeUserScriptRules(this.settings.userScriptRules, payload.userScriptRules);
    this.settings.webNotes = mergeWebNotes(this.settings.webNotes, payload.webNotes);
    await this.saveSettings();
    await this.loadSettings();
    await this.saveSettings();
    await this.addConsole("info", `Portable import merged: ${payload.bookmarks.length} bookmarks, ${payload.userScriptRules.length} scripts, ${payload.webNotes.length} web notes`);
    return {
      bookmarks: payload.bookmarks.length,
      scripts: payload.userScriptRules.length,
      notes: payload.webNotes.length
    };
  }

  async importPortableDataFromClipboard(): Promise<void> {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      new Notice(this.tr("clipboardEmpty"));
      return;
    }
    const summary = await this.importPortableDataText(text);
    new Notice(`${this.tr("completedAction", { label: this.tr("universalImport") })}: ${summary.bookmarks}/${summary.scripts}/${summary.notes}`);
  }

  async addConsole(level: BrowserConsoleEntry["level"], message: string, url?: string): Promise<void> {
    this.settings.consoleEntries.unshift({
      level,
      message,
      url,
      time: Date.now()
    });
    this.settings.consoleEntries = this.settings.consoleEntries.slice(0, MAX_CONSOLE_ENTRIES);
    await this.saveSettings();
  }

  formatConsoleEntries(): string {
    if (!this.settings.consoleEntries.length) return "Mobile Webviewer console is empty.";
    return this.settings.consoleEntries
      .slice(0, 40)
      .map((entry) => {
        const date = new Date(entry.time).toLocaleString();
        const page = entry.url ? ` ${entry.url}` : "";
        return `[${date}] ${entry.level.toUpperCase()} ${entry.message}${page}`;
      })
      .join("\n");
  }

  async ensureVaultFolder(path: string): Promise<void> {
    const clean = normalizePath(path).replace(/\/+$/, "");
    if (!clean) return;
    const parts = clean.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  async uniqueVaultPath(folder: string, fileName: string): Promise<string> {
    const cleanFolder = normalizePath(folder || DEFAULT_DOWNLOAD_FOLDER);
    const safeName = sanitizeFileName(fileName, "download");
    const dot = safeName.lastIndexOf(".");
    const base = dot > 0 ? safeName.slice(0, dot) : safeName;
    const ext = dot > 0 ? safeName.slice(dot) : "";
    let candidate = normalizePath(`${cleanFolder}/${safeName}`);
    let index = 2;
    while (await this.app.vault.adapter.exists(candidate)) {
      candidate = normalizePath(`${cleanFolder}/${base} (${index})${ext}`);
      index++;
    }
    return candidate;
  }

  normalizeDownloadFolder(): string {
    return normalizePath(this.settings.downloadFolder || DEFAULT_DOWNLOAD_FOLDER);
  }

  createDownloadEntry(url: string, fileName: string, path: string, format: DownloadEntry["format"], mime = ""): DownloadEntry {
    return {
      id: format === "file" ? `dl-${simpleHash(`${url}|${fileName}`)}` : `dl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      url,
      fileName,
      path,
      mime,
      status: "queued",
      format,
      bytesReceived: 0,
      bytesTotal: 0,
      progress: 0,
      connections: 1,
      resumable: false,
      message: "",
      time: Date.now()
    };
  }

  async upsertDownload(entry: DownloadEntry): Promise<void> {
    this.settings.downloads = [
      entry,
      ...this.settings.downloads.filter((item) => item.id !== entry.id)
    ].slice(0, MAX_DOWNLOADS);
    await this.saveSettings();
  }

  async updateDownload(id: string, patch: Partial<DownloadEntry>): Promise<void> {
    const entry = this.settings.downloads.find((item) => item.id === id);
    if (!entry) return;
    Object.assign(entry, patch, { time: Date.now() });
    this.settings.downloads = [
      entry,
      ...this.settings.downloads.filter((item) => item.id !== id)
    ].slice(0, MAX_DOWNLOADS);
    await this.saveSettings();
  }

  async copyDownloadPath(entry: DownloadEntry): Promise<void> {
    const path = entry.path || entry.message || entry.url;
    await navigator.clipboard.writeText(path);
    new Notice(`Path copied: ${path}`);
    await this.addConsole("info", `Copied download path: ${path}`, entry.url);
  }

  async revealDownloadEntry(entry: DownloadEntry): Promise<void> {
    if (!entry.path) {
      await this.copyDownloadPath(entry);
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(entry.path);
    if (file instanceof TFile) {
      const absolutePath = this.vaultPathToAbsolute(entry.path);
      if (absolutePath) {
        const electronShell = this.getElectronShell();
        if (electronShell?.showItemInFolder) {
          electronShell.showItemInFolder(absolutePath);
          await this.addConsole("info", `Revealed download: ${absolutePath}`, entry.url);
          return;
        }
      }
      await this.app.workspace.getLeaf(true).openFile(file);
      await this.addConsole("info", `Opened download from reveal fallback: ${entry.path}`, entry.url);
      return;
    }
    await this.copyDownloadPath(entry);
  }

  async openDownloadEntry(entry: DownloadEntry): Promise<void> {
    if (!entry.path) {
      await this.copyDownloadPath(entry);
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(entry.path);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file);
      new Notice(`Opened ${entry.fileName || entry.path}`);
      await this.addConsole("info", `Opened download: ${entry.path}`, entry.url);
      return;
    }
    await this.copyDownloadPath(entry);
    new Notice(this.tr("fileMissingPathCopied"));
    await this.addConsole("warn", `Download file not found: ${entry.path}`, entry.url);
  }

  vaultPathToAbsolute(path: string): string {
    const adapter = this.app.vault.adapter as { basePath?: string; getBasePath?: () => string };
    const base = adapter.basePath ?? adapter.getBasePath?.() ?? "";
    if (!base) return "";
    return `${base.replace(/[\\/]+$/, "")}/${normalizePath(path)}`.replace(/\//g, "\\");
  }

  getElectronShell(): { showItemInFolder?: (fullPath: string) => void; openPath?: (fullPath: string) => Promise<string> } | null {
    try {
      const req = (window as unknown as { require?: (id: string) => { shell?: unknown } }).require;
      const electron = req?.("electron") as { shell?: { showItemInFolder?: (fullPath: string) => void; openPath?: (fullPath: string) => Promise<string> } } | undefined;
      return electron?.shell ?? null;
    } catch {
      return null;
    }
  }

  async downloadCurrentPageHtml(url: string, title: string): Promise<DownloadEntry> {
    const folder = this.normalizeDownloadFolder();
    await this.ensureVaultFolder(folder);
    const fileName = appendFileExtension(sanitizeFileName(title || hostName(url), "page"), "html");
    const path = await this.uniqueVaultPath(folder, fileName);
    const entry = this.createDownloadEntry(url, fileName, path, "html", "text/html");
    await this.upsertDownload({ ...entry, status: "downloading", message: "Saving HTML" });
    try {
      const response = await requestUrl({
        url,
        method: "GET",
        headers: this.requestHeaders("text/html,application/xhtml+xml,*/*")
      });
      const bytes = textToArrayBuffer(response.text);
      await this.app.vault.adapter.writeBinary(path, bytes);
      await this.updateDownload(entry.id, {
        status: "completed",
        bytesReceived: bytes.byteLength,
        bytesTotal: bytes.byteLength,
        progress: 100,
        path,
        message: "HTML saved"
      });
      await this.addConsole("info", `Saved HTML: ${path}`, url);
      new Notice(`HTML saved: ${path}`);
      return this.settings.downloads.find((item) => item.id === entry.id) ?? entry;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.updateDownload(entry.id, { status: "error", message, progress: 0 });
      await this.addConsole("error", `HTML save failed: ${message}`, url);
      new Notice(this.tr("htmlSaveFailed"));
      return this.settings.downloads.find((item) => item.id === entry.id) ?? entry;
    }
  }

  async downloadCurrentPageMhtml(url: string, title: string): Promise<DownloadEntry> {
    const folder = this.normalizeDownloadFolder();
    await this.ensureVaultFolder(folder);
    const fileName = appendFileExtension(sanitizeFileName(title || hostName(url), "page"), "mht");
    const path = await this.uniqueVaultPath(folder, fileName);
    const entry = this.createDownloadEntry(url, fileName, path, "mhtml", "multipart/related");
    await this.upsertDownload({ ...entry, status: "downloading", message: "Saving MHT" });
    try {
      const mhtml = await this.buildMhtml(url, title);
      const bytes = textToArrayBuffer(mhtml);
      await this.app.vault.adapter.writeBinary(path, bytes);
      await this.updateDownload(entry.id, {
        status: "completed",
        bytesReceived: bytes.byteLength,
        bytesTotal: bytes.byteLength,
        progress: 100,
        path,
        message: "MHT saved"
      });
      await this.addConsole("info", `Saved MHT: ${path}`, url);
      new Notice(`MHT saved: ${path}`);
      return this.settings.downloads.find((item) => item.id === entry.id) ?? entry;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.updateDownload(entry.id, { status: "error", message, progress: 0 });
      await this.addConsole("error", `MHT save failed: ${message}`, url);
      new Notice(this.tr("mhtSaveFailed"));
      return this.settings.downloads.find((item) => item.id === entry.id) ?? entry;
    }
  }

  async saveOfflinePage(url: string, title: string): Promise<void> {
    const page = await this.fetchNotePage(url);
    await this.rememberPageCache(page);
    await this.addReadingList({ title: title || page.title || hostName(url), url, time: Date.now() });
    await this.downloadCurrentPageHtml(url, title || page.title || hostName(url));
    await this.addConsole("info", "Offline page saved", url);
  }

  async createShortcutFile(url: string, title: string): Promise<string> {
    const folder = this.normalizeDownloadFolder();
    await this.ensureVaultFolder(folder);
    const fileName = appendFileExtension(sanitizeFileName(title || hostName(url), "shortcut"), "url");
    const path = await this.uniqueVaultPath(folder, fileName);
    const body = `[InternetShortcut]\r\nURL=${url}\r\n`;
    await this.app.vault.adapter.write(path, body);
    await this.addConsole("info", `Shortcut saved: ${path}`, url);
    return path;
  }

  async sharePage(url: string, title: string): Promise<void> {
    const text = `${title || hostName(url)}\n${url}`;
    const nav = navigator as Navigator & { share?: (data: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (nav.share) {
      await nav.share({ title: title || hostName(url), text: title || hostName(url), url });
    } else {
      await navigator.clipboard.writeText(text);
      new Notice(this.tr("shareTextCopied"));
    }
    await this.addConsole("info", "Share prepared", url);
  }

  async readPageAloud(url: string): Promise<void> {
    const page = await this.fetchNotePage(url);
    const text = `${page.title}. ${page.excerpt || page.content}`.replace(/\s+/g, " ").slice(0, 1800);
    if (!text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = /[\u4e00-\u9fff]/.test(text) ? "zh-CN" : "en-US";
    window.speechSynthesis.speak(utterance);
    await this.addConsole("info", "Read aloud started", url);
  }

  async extractPageAssets(url: string): Promise<{ links: string[]; media: string[]; scripts: string[]; styles: string[]; html: string }> {
    const response = await requestUrl({
      url,
      method: "GET",
      headers: this.requestHeaders("text/html,application/xhtml+xml,*/*")
    });
    const parser = new DOMParser();
    const doc = parser.parseFromString(response.text, "text/html");
    const unique = (items: string[]) => Array.from(new Set(items.filter((item) => /^https?:\/\//i.test(item)))).slice(0, 80);
    return {
      links: unique(Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]")).map((item) => absoluteUrl(item.href, url))),
      media: unique([
        ...imageCandidatesFromDocument(doc, url, 80),
        ...Array.from(doc.querySelectorAll<HTMLVideoElement | HTMLAudioElement | HTMLSourceElement>("video[src], audio[src], source[src]")).map((item) => absoluteUrl(item.getAttribute("src") ?? "", url)),
        ...extractMediaUrlsFromText(response.text)
      ]),
      scripts: unique(Array.from(doc.querySelectorAll<HTMLScriptElement>("script[src]")).map((item) => absoluteUrl(item.src, url))),
      styles: unique(Array.from(doc.querySelectorAll<HTMLLinkElement>("link[rel~='stylesheet'][href]")).map((item) => absoluteUrl(item.href, url))),
      html: response.text
    };
  }

  async buildMhtml(url: string, title: string): Promise<string> {
    const pageResponse = await requestUrl({
      url,
      method: "GET",
        headers: this.requestHeaders("text/html,application/xhtml+xml,*/*")
    });
    const parser = new DOMParser();
    const doc = parser.parseFromString(pageResponse.text, "text/html");
    const resources: { url: string; cid: string; mime: string; body: ArrayBuffer }[] = [];
    const candidates: { element: Element; attr: string; url: string }[] = [];
    doc.querySelectorAll<HTMLImageElement>("img").forEach((element) => {
      const raw =
        bestSrcsetCandidate(element.getAttribute("srcset") ?? element.getAttribute("data-srcset") ?? "") ||
        element.getAttribute("src") ||
        element.getAttribute("data-src") ||
        element.getAttribute("data-original") ||
        element.getAttribute("data-original-src") ||
        element.getAttribute("data-lazy-src") ||
        "";
      const clean = cleanImageCandidate(raw, url);
      if (clean) candidates.push({ element, attr: "src", url: clean });
    });
    doc.querySelectorAll<HTMLLinkElement>("link[rel~='stylesheet'][href]").forEach((element) => {
      candidates.push({ element, attr: "href", url: absoluteUrl(element.href, url) });
    });
    doc.querySelectorAll<HTMLScriptElement>("script[src]").forEach((element) => {
      candidates.push({ element, attr: "src", url: absoluteUrl(element.src, url) });
    });

    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (resources.length >= MAX_MHTML_RESOURCES) break;
      if (!/^https?:\/\//i.test(candidate.url) || seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      try {
        const response = await requestUrl({
          url: candidate.url,
          method: "GET",
          headers: this.requestHeaders("*/*")
        });
        const mime = headerValue(response.headers, "content-type") || "application/octet-stream";
        const cid = makeContentId(resources.length + 1, candidate.url);
        resources.push({ url: candidate.url, cid, mime, body: response.arrayBuffer });
        candidate.element.setAttribute(candidate.attr, `cid:${cid}`);
      } catch {
        // Keep the original external URL when a resource cannot be fetched.
      }
    }

    const boundary = `----=_MobileWebviewer_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const html = `<!doctype html>\n${doc.documentElement.outerHTML}`;
    const parts = [
      `From: <Saved by Mobile Webviewer>\r\nSubject: ${title || hostName(url)}\r\nDate: ${new Date().toUTCString()}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/related; type="text/html"; boundary="${boundary}"\r\n\r\n`,
      `--${boundary}\r\nContent-Type: text/html; charset="utf-8"\r\nContent-Transfer-Encoding: base64\r\nContent-Location: ${url}\r\n\r\n${arrayBufferToBase64(textToArrayBuffer(html))}\r\n`
    ];
    for (const resource of resources) {
      parts.push(`--${boundary}\r\nContent-Type: ${resource.mime}\r\nContent-Transfer-Encoding: base64\r\nContent-Location: ${resource.url}\r\nContent-ID: <${resource.cid}>\r\n\r\n${arrayBufferToBase64(resource.body)}\r\n`);
    }
    parts.push(`--${boundary}--\r\n`);
    return parts.join("");
  }

  async downloadUrlFile(url: string): Promise<DownloadEntry> {
    const cleanUrl = normalizeInput(url, this.settings.searchUrl);
    const folder = this.normalizeDownloadFolder();
    await this.ensureVaultFolder(folder);
    const info = await this.getRemoteFileInfo(cleanUrl);
    const fileName = info.fileName || fileNameFromUrl(cleanUrl, info.mime);
    const path = await this.uniqueVaultPath(folder, fileName);
    const entry = this.createDownloadEntry(cleanUrl, fileName, path, "file", info.mime);
    entry.bytesTotal = info.size;
    entry.resumable = info.acceptRanges;
    entry.connections = info.acceptRanges && info.size >= MIN_SEGMENTED_DOWNLOAD_BYTES
      ? clampNumber(this.settings.downloadConnections, 1, 8)
      : 1;
    await this.upsertDownload({ ...entry, status: "downloading", message: "Downloading" });

    try {
      if (entry.resumable && entry.bytesTotal > 0 && entry.connections > 1) {
        await this.downloadSegmented(entry);
      } else {
        await this.downloadSingle(entry);
      }
      const finalEntry = this.settings.downloads.find((item) => item.id === entry.id) ?? entry;
      new Notice(`Download complete: ${finalEntry.path || entry.path}`);
      return finalEntry;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.updateDownload(entry.id, { status: "error", message });
      await this.addConsole("error", `Download failed: ${message}`, cleanUrl);
      new Notice(this.tr("downloadFailed"));
      return this.settings.downloads.find((item) => item.id === entry.id) ?? entry;
    }
  }

  async getRemoteFileInfo(url: string): Promise<{ size: number; mime: string; acceptRanges: boolean; fileName: string }> {
    try {
      const response = await requestUrl({
        url,
        method: "HEAD",
        headers: this.requestHeaders("*/*")
      });
      const size = Number(headerValue(response.headers, "content-length")) || 0;
      const mime = headerValue(response.headers, "content-type") || "application/octet-stream";
      const acceptRanges = /bytes/i.test(headerValue(response.headers, "accept-ranges"));
      const fileName = contentDispositionFileName(headerValue(response.headers, "content-disposition"));
      return { size, mime, acceptRanges, fileName };
    } catch {
      return { size: 0, mime: "application/octet-stream", acceptRanges: false, fileName: "" };
    }
  }

  async downloadSingle(entry: DownloadEntry): Promise<void> {
    const response = await requestUrl({
      url: entry.url,
      method: "GET",
      headers: this.requestHeaders("*/*")
    });
    const mime = headerValue(response.headers, "content-type") || entry.mime || "application/octet-stream";
    const fileName = contentDispositionFileName(headerValue(response.headers, "content-disposition")) || entry.fileName || fileNameFromUrl(entry.url, mime);
    const path = entry.path.endsWith(fileName) ? entry.path : await this.uniqueVaultPath(this.normalizeDownloadFolder(), fileName);
    await this.app.vault.adapter.writeBinary(path, response.arrayBuffer);
    await this.updateDownload(entry.id, {
      status: "completed",
      fileName,
      path,
      mime,
      bytesReceived: response.arrayBuffer.byteLength,
      bytesTotal: response.arrayBuffer.byteLength,
      progress: 100,
      connections: 1,
      resumable: false,
      message: "Single connection"
    });
    await this.addConsole("info", `Downloaded: ${path}`, entry.url);
  }

  async downloadSegmented(entry: DownloadEntry): Promise<void> {
    const total = entry.bytesTotal;
    const connections = clampNumber(entry.connections || DEFAULT_DOWNLOAD_CONNECTIONS, 2, 8);
    const segmentSize = Math.ceil(total / connections);
    const partFolder = normalizePath(`${this.normalizeDownloadFolder()}/.mwv-parts/${entry.id}`);
    await this.ensureVaultFolder(partFolder);

    const partBuffers = await Promise.all(Array.from({ length: connections }, async (_, index) => {
      const start = index * segmentSize;
      const end = Math.min(total - 1, start + segmentSize - 1);
      const expected = end - start + 1;
      const partPath = normalizePath(`${partFolder}/part-${index}.bin`);
      if (await this.app.vault.adapter.exists(partPath)) {
        const cached = await this.app.vault.adapter.readBinary(partPath);
        if (cached.byteLength === expected) {
          await this.updateDownload(entry.id, {
            bytesReceived: Math.min(total, (this.settings.downloads.find((item) => item.id === entry.id)?.bytesReceived ?? 0) + cached.byteLength),
            progress: Math.min(99, Math.round(((index + 1) / connections) * 100)),
            message: `Reused part ${index + 1}/${connections}`
          });
          return cached;
        }
      }
      const response = await requestUrl({
        url: entry.url,
        method: "GET",
        headers: {
          ...this.requestHeaders("*/*"),
          "Range": `bytes=${start}-${end}`
        }
      });
      await this.app.vault.adapter.writeBinary(partPath, response.arrayBuffer);
      await this.updateDownload(entry.id, {
        bytesReceived: Math.min(total, (this.settings.downloads.find((item) => item.id === entry.id)?.bytesReceived ?? 0) + response.arrayBuffer.byteLength),
        progress: Math.min(99, Math.round(((index + 1) / connections) * 100)),
        message: `Downloaded part ${index + 1}/${connections}`
      });
      return response.arrayBuffer;
    }));

    const merged = concatArrayBuffers(partBuffers);
    await this.app.vault.adapter.writeBinary(entry.path, merged);
    await this.updateDownload(entry.id, {
      status: "completed",
      bytesReceived: merged.byteLength,
      bytesTotal: merged.byteLength,
      progress: 100,
      connections,
      resumable: true,
      message: `Segmented ${connections} connections`
    });
    await this.addConsole("info", `Segmented download complete: ${entry.path}`, entry.url);
  }

  matchesUserScriptRule(rule: UserScriptRule, url: string): boolean {
    const match = rule.match.trim();
    if (!match) return true;
    if (match.includes("*")) {
      return wildcardMatch(match, url) || wildcardMatch(match, hostName(url));
    }
    return url.toLowerCase().includes(match.toLowerCase()) || hostName(url).toLowerCase().includes(match.toLowerCase());
  }

  getActiveUserScriptRules(url: string): UserScriptRule[] {
    if (!this.settings.userScriptsEnabled) return [];
    return (this.settings.userScriptRules ?? [])
      .filter((rule) => rule.enabled && this.matchesUserScriptRule(rule, url));
  }

  buildFrameSandbox(allowDownloads = false): string {
    const tokens = [
      allowDownloads ? "allow-downloads" : "",
      "allow-forms",
      "allow-modals",
      "allow-pointer-lock",
      "allow-popups",
      "allow-popups-to-escape-sandbox",
      "allow-same-origin",
      this.settings.jsDisabled ? "" : "allow-scripts",
      "allow-top-navigation-by-user-activation"
    ];
    return tokens.filter(Boolean).join(" ");
  }

  isElectronWebview(element: Element | null | undefined): element is ElectronWebviewElement {
    return Boolean(element && element.tagName.toLowerCase() === "webview");
  }

  isBrowserSurfaceReady(element: Element | null | undefined): boolean {
    if (!element || !element.isConnected) return false;
    if (!this.isElectronWebview(element)) return true;
    return element._mwvReady === true && element._mwvDestroyed !== true;
  }

  disposeBrowserSurface(element: BrowserSurfaceElement | null | undefined): void {
    if (!this.isElectronWebview(element)) return;
    element._mwvRawElementEditorEnabled = false;
    element._mwvDestroyed = true;
    element._mwvReady = false;
    element._mwvDispose?.();
    element._mwvDispose = undefined;
  }

  disposeBrowserSurfacesIn(root: ParentNode | null | undefined): void {
    if (!root) return;
    root.querySelectorAll<LocalNoteEmbedElement>(".mwv-local-note-surface").forEach((surface) => {
      const embed = surface.closest<LocalNoteEmbedElement>(".mwv-embed");
      embed?._mwvMarkdownComponent?.unload();
      if (embed) embed._mwvMarkdownComponent = undefined;
    });
    root.querySelectorAll<BrowserSurfaceElement>(".mwv-real-webview, .mwv-live-frame").forEach((surface) => {
      const proxyState = this.proxyFrameState.get(surface);
      proxyState?.dispose();
      this.proxyFrameState.delete(surface);
      this.disposeBrowserSurface(surface);
    });
  }

  isRawRealWebview(element: Element | null | undefined): boolean {
    return this.isElectronWebview(element) && Boolean(
      element.classList.contains("mwv-raw-surface") ||
      element.closest(".mwv-live-browser, .mwv-frame-wrap.is-live-page")
    );
  }

  isRawRealBrowserSurface(element: Element | null | undefined): boolean {
    return Boolean(
      element &&
      (this.isRawRealWebview(element) ||
        (element.classList.contains("mwv-raw-surface") ||
          (element.tagName.toLowerCase() === "iframe" && element.closest(".mwv-live-browser, .mwv-frame-wrap.is-live-page"))))
    );
  }

  isNoteBrowserWebMode(root: Element | null | undefined): boolean {
    if (!root) return false;
    if (root.matches(".mwv-embed.is-web-front, .mwv-note-embed.is-web-front, .mwv-bing-home.is-web-front")) return true;
    return Boolean(root.querySelector?.(".mwv-embed.is-web-front, .mwv-note-embed.is-web-front, .mwv-bing-home.is-web-front"));
  }

  isNoteBrowserRawEditingMode(root: Element | null | undefined): boolean {
    if (!root) return false;
    const embed = root.matches(MWV_DEDUPE_ROOT_SELECTOR) && isHtmlElement(root)
      ? root
      : root.closest<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR) ?? root.querySelector?.<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR);
    return embed?.dataset.mwvNotewebElementEdit === "true";
  }

  applyNoteBrowserWebIsolation(embed: HTMLElement, enabled = true): void {
    if (!embed.isConnected || !this.isNoteWebOwnedElement(embed)) return;
    const documentEl = embed.closest<HTMLElement>(".mwv-note-browser-document") ?? embed;
    const selector = ".notedraw-underlay-embed-layer, .notedraw-embed-layer, .notedraw-underlay-canvas, .notedraw-static-canvas, .notedraw-canvas, .notedraw-toolbar, .notedraw-palette-panel, .notedraw-brush-panel, .notedraw-text-panel, .notedraw-selection-menu, .notedraw-format-toolbar, .notedraw-file-input";
    const elements = new Set<HTMLElement>(Array.from(documentEl.querySelectorAll<HTMLElement>(selector)));
    for (const controller of this.collectNoteDrawControllers(embed)) {
      const candidate = controller as NoteDrawControllerLike & Record<string, unknown>;
      for (const key of ["canvas", "staticCanvas", "embedLayer", "toolbar", "palettePanel", "brushPanel", "textPanel", "selectionMenu", "formatToolbar"]) {
        const element = candidate[key];
        if (element instanceof HTMLElement) elements.add(element);
      }
    }
    for (const element of elements) {
      if (enabled) {
        element.addClass("mwv-noteweb-raw-hidden");
      } else {
        element.removeClass("mwv-noteweb-raw-hidden");
      }
    }
    this.queueNoteDrawControllerRestore(embed);
  }

  supportsElectronWebview(): boolean {
    const platform = (window as BrowserWindowWithProcess).process?.versions;
    if (!platform?.electron) return false;
    try {
      const probe = createEl("webview" as keyof HTMLElementTagNameMap) as ElectronWebviewElement;
      probe.addClass("mwv-webview-probe");
      appDocument().body?.appendChild(probe);
      const supported =
        typeof probe === "object" &&
        probe.tagName.toLowerCase() === "webview" &&
        (typeof probe.reload === "function" || typeof probe.getURL === "function" || typeof probe.executeJavaScript === "function");
      probe.remove();
      return supported;
    } catch {
      return false;
    }
  }

  private readonly proxyFrameState = new WeakMap<BrowserSurfaceElement, { url: string; dispose: () => void }>();
  private proxyFindSeq = 0;
  private readonly proxyFindResolvers = new Map<number, (count: number) => void>();

  /**
   * Detects responses that refuse to be embedded (X-Frame-Options /
   * CSP frame-ancestors). On mobile there is no Electron <webview>, so those
   * sites used to fail with net::ERR_BLOCKED_BY_RESPONSE in the live iframe.
   */
  isEmbedBlockedByHeaders(headers: Record<string, string> | undefined): boolean {
    if (!headers) return false;
    const xfo = (headerValue(headers, "x-frame-options") || "").trim().toLowerCase();
    if (xfo === "deny" || xfo === "sameorigin" || xfo.startsWith("allow-from")) return true;
    const csp = (headerValue(headers, "content-security-policy") || "").toLowerCase();
    const match = csp.match(/frame-ancestors([^;]*)/);
    if (!match) return false;
    const value = match[1].trim();
    return !value.includes("*");
  }

  buildProxyFrameSandbox(): string {
    const tokens = ["allow-forms", "allow-modals", "allow-popups", "allow-popups-to-escape-sandbox", "allow-pointer-lock"];
    if (!this.settings.jsDisabled) tokens.push("allow-scripts");
    return tokens.join(" ");
  }

  buildProxyRuntimeCss(): string {
    const rules: string[] = [];
    if (this.settings.nightMode) {
      rules.push("html{filter:invert(0.90) hue-rotate(180deg);background:#111!important}");
      rules.push("img,video,picture,canvas,svg{filter:invert(1.02) hue-rotate(180deg)}");
    }
    if (this.settings.eyeProtectionMode) rules.push("html{background:#f5efdc!important}body{background:#f5efdc!important}");
    if (this.settings.adBlockEnabled) rules.push(`${AD_CANDIDATE_SELECTOR}{display:none!important}`);
    else if (this.settings.markAdsEnabled) rules.push(`${AD_CANDIDATE_SELECTOR}{outline:2px dashed #b55!important}`);
    if (this.settings.noImageMode) rules.push("img,picture,video{visibility:hidden!important}");
    if (this.settings.pageZoom && this.settings.pageZoom !== 100) rules.push(`html{zoom:${this.settings.pageZoom}%}`);
    return rules.join("\n");
  }

  rewriteProxyHtml(rawHtml: string, url: string): string {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(rawHtml, "text/html");
      doc.querySelectorAll("meta[http-equiv]").forEach((meta) => {
        const equiv = (meta.getAttribute("http-equiv") ?? "").trim().toLowerCase();
        if (equiv === "content-security-policy" || equiv === "x-frame-options") meta.remove();
      });
      // Subresource integrity fails once we re-host the document.
      doc.querySelectorAll("[integrity]").forEach((node) => node.removeAttribute("integrity"));
      doc.querySelectorAll("base").forEach((node) => node.remove());
      const head = doc.head ?? doc.documentElement;
      const base = doc.createElement("base");
      base.setAttribute("href", url);
      head.prepend(base);
      const runtime = doc.createElement("style");
      runtime.setAttribute("data-mwv-proxy-runtime", "");
      runtime.textContent = this.buildProxyRuntimeCss();
      head.appendChild(runtime);
      const seed = doc.createElement("script");
      seed.setAttribute("data-mwv-proxy-seed", "");
      seed.textContent = this.proxySeedScript(url);
      head.appendChild(seed);
      const bridge = doc.createElement("script");
      bridge.setAttribute("data-mwv-proxy-bridge", "");
      bridge.textContent = MWV_PROXY_BRIDGE_SOURCE;
      head.appendChild(bridge);
      return `<!doctype html>\n${doc.documentElement.outerHTML}`;
    } catch {
      return rawHtml;
    }
  }

  async fetchLiveDocument(url: string): Promise<{ text: string; headers: Record<string, string> } | null> {
    try {
      const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 12000));
      const headers = this.requestHeaders("text/html,application/xhtml+xml,*/*");
      const cookie = this.cookieHeaderForUrl(url);
      if (cookie) headers["Cookie"] = cookie;
      const request = requestUrl({ url, method: "GET", headers });
      const response = await Promise.race([request, timeout]);
      if (!response) return null;
      this.captureSetCookies(url, response.headers);
      const contentType = headerValue(response.headers, "content-type") || "";
      if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) return null;
      return { text: response.text, headers: response.headers };
    } catch {
      return null;
    }
  }

  wireProxyBridge(frame: BrowserSurfaceElement, callbacks: BrowserSurfaceCallbacks): void {
    if (this.isElectronWebview(frame) || this.proxyFrameState.has(frame)) return;
    const onMessage = (event: MessageEvent) => {
      if (!frame.isConnected || event.source !== frame.contentWindow) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== "object" || typeof data.mwvBridge !== "string") return;
      const kind = data.mwvBridge;
      if (kind === "navigate" || kind === "new-window") {
        const next = String(data.url ?? "");
        if (!/^https?:\/\//i.test(next)) return;
        if (kind === "new-window") {
          void callbacks.onNewWindow?.(next);
          return;
        }
        void this.loadProxyNavigation(frame, next, callbacks);
        return;
      }
      if (kind === "title") {
        void callbacks.onTitle?.(String(data.title ?? ""));
        return;
      }
      if (kind === "console") {
        void callbacks.onConsole?.(data.level === "error" ? "error" : "info", String(data.message ?? ""), this.proxyFrameState.get(frame)?.url);
        return;
      }
      if (kind === "post-unsupported") {
        void callbacks.onConsole?.("warn", `${this.tr("postFormUnsupported")}: ${String(data.url ?? "")}`, this.proxyFrameState.get(frame)?.url);
        return;
      }
      if (kind === "post-form") {
        void this.submitProxyForm(frame, String(data.url ?? ""), data.entries, callbacks);
        return;
      }
      if (kind === "fetch") {
        void this.handleProxyFetch(frame, data);
        return;
      }
      if (kind === "cookie-set") {
        const pageUrl = this.proxyFrameState.get(frame)?.url ?? "";
        this.storeCookieFromDocument(pageUrl, String(data.raw ?? ""));
        return;
      }
      if (kind === "storage-set") {
        const pageUrl = this.proxyFrameState.get(frame)?.url ?? "";
        this.handleProxyStorageSet(pageUrl, String(data.kind ?? "local"), String(data.key ?? ""), data.value === null || data.value === undefined ? null : String(data.value));
        return;
      }
      if (kind === "find-result") {
        const requestId = Number(data.requestId ?? 0);
        const resolve = this.proxyFindResolvers.get(requestId);
        if (resolve) {
          this.proxyFindResolvers.delete(requestId);
          resolve(Number(data.count ?? 0));
        }
      }
    };
    window.addEventListener("message", onMessage);
    this.proxyFrameState.set(frame, { url: "", dispose: () => window.removeEventListener("message", onMessage) });
  }

  private static readonly STRIPPED_RESPONSE_HEADERS = new Set(["set-cookie", "content-encoding", "transfer-encoding", "content-length", "connection"]);

  private outHeadersForProxy(headers: Record<string, string> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers ?? {})) {
      const lower = key.toLowerCase();
      if (MobileWebviewerPlugin.STRIPPED_RESPONSE_HEADERS.has(lower)) continue;
      out[lower] = String(value);
    }
    return out;
  }

  /** Relays page-side fetch()/XHR through requestUrl so cookies and sessions keep working in proxy mode. */
  async handleProxyFetch(frame: BrowserSurfaceElement, data: Record<string, unknown>): Promise<void> {
    const url = String(data.url ?? "");
    if (!/^https?:\/\//i.test(url) || !frame.isConnected) return;
    const method = (String(data.method ?? "GET") || "GET").toUpperCase();
    const rawHeaders = (data.headers && typeof data.headers === "object" ? data.headers : {}) as Record<string, unknown>;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawHeaders)) {
      if (typeof value === "string") headers[key.toLowerCase()] = value;
    }
    const body = typeof data.body === "string" ? data.body : "";
    if (body && !headers["content-type"]) headers["content-type"] = "application/x-www-form-urlencoded;charset=UTF-8";
    const cookie = this.cookieHeaderForUrl(url);
    if (cookie) headers["cookie"] = cookie;
    const reply = (status: number, statusText: string, outHeaders: Record<string, string>, text: string) => {
      (frame as HTMLIFrameElement).contentWindow?.postMessage({ mwvBridge: "fetch-result", requestId: Number(data.requestId ?? 0), status, statusText, headers: outHeaders, body: text }, "*");
    };
    try {
      const response = await requestUrl({ url, method, headers: { ...this.requestHeaders("*/*"), ...headers }, body: method === "GET" || method === "HEAD" ? undefined : body });
      this.captureSetCookies(url, response.headers);
      reply(response.status, "", this.outHeadersForProxy(response.headers), response.text);
    } catch (error) {
      const err = error as { status?: number; headers?: Record<string, string>; text?: string };
      if (typeof err?.status === "number" && err.status > 0) {
        this.captureSetCookies(url, err.headers);
        reply(err.status, "HTTP error", this.outHeadersForProxy(err.headers), typeof err.text === "string" ? err.text : "");
      } else {
        reply(0, "Network error", {}, "");
      }
    }
  }

  /** Submits a proxied POST form via requestUrl and renders the result as a proxied document. */
  async submitProxyForm(frame: BrowserSurfaceElement, url: string, entries: unknown, callbacks: BrowserSurfaceCallbacks): Promise<void> {
    if (!/^https?:\/\//i.test(url) || !frame.isConnected) return;
    const pairs: [string, string][] = Array.isArray(entries)
      ? entries.map((item): [string, string] => {
          const pair = Array.isArray(item) ? item : [];
          return [String(pair[0] ?? ""), typeof pair[1] === "string" ? pair[1] : String(pair[1] ?? "")];
        })
      : [];
    const body = pairs.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
    const headers = this.requestHeaders("text/html,application/xhtml+xml,*/*");
    headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
    const cookie = this.cookieHeaderForUrl(url);
    if (cookie) headers["Cookie"] = cookie;
    void callbacks.onLoading?.(true, url);
    try {
      const response = await requestUrl({ url, method: "POST", headers, body });
      this.captureSetCookies(url, response.headers);
      this.renderProxyDocument(frame, url, response.text, callbacks);
    } catch (error) {
      const err = error as { status?: number; text?: string; headers?: Record<string, string> };
      const text = typeof err?.text === "string" && err.text ? err.text : "";
      if (text) {
        this.captureSetCookies(url, err.headers);
        this.renderProxyDocument(frame, url, text, callbacks);
      } else {
        void callbacks.onConsole?.("warn", `${this.tr("postFormUnsupported")}: ${url}`, url);
        void callbacks.onLoading?.(false, url);
      }
    }
    void callbacks.onNavigate?.(url);
  }

  renderProxyDocument(frame: BrowserSurfaceElement, url: string, rawHtml: string, callbacks: BrowserSurfaceCallbacks = {}): void {
    if (this.isElectronWebview(frame)) return;
    const state = this.proxyFrameState.get(frame);
    if (state) state.url = url;
    frame.dataset.mwvProxyUrl = url;
    frame.setAttribute("sandbox", this.buildProxyFrameSandbox());
    frame.removeAttribute("src");
    frame.srcdoc = this.rewriteProxyHtml(rawHtml, url);
    void callbacks.onLoading?.(false, url);
  }

  async smartLoadBrowserFrame(frame: BrowserSurfaceElement, url: string, callbacks: BrowserSurfaceCallbacks = {}): Promise<void> {
    if (this.isElectronWebview(frame)) {
      frame.src = url;
      return;
    }
    const clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) {
      frame.removeAttribute("srcdoc");
      frame.src = clean;
      return;
    }
    this.wireProxyBridge(frame, callbacks);
    const doc = await this.fetchLiveDocument(clean);
    if (!frame.isConnected) return;
    if (doc && this.isEmbedBlockedByHeaders(doc.headers)) {
      this.renderProxyDocument(frame, clean, doc.text, callbacks);
      return;
    }
    // Embedding is allowed (or the probe failed) — load natively so cookies
    // and full page JavaScript keep working. Existing load/error/timeout
    // listeners below still provide the reader fallback.
    frame.removeAttribute("srcdoc");
    frame.removeAttribute("data-mwv-proxy-url");
    frame.src = clean;
  }

  async loadProxyNavigation(frame: BrowserSurfaceElement, url: string, callbacks: BrowserSurfaceCallbacks): Promise<void> {
    const doc = await this.fetchLiveDocument(url);
    if (!frame.isConnected) return;
    if (doc && this.isEmbedBlockedByHeaders(doc.headers)) {
      this.renderProxyDocument(frame, url, doc.text, callbacks);
      void callbacks.onNavigate?.(url);
      return;
    }
    frame.removeAttribute("srcdoc");
    frame.removeAttribute("data-mwv-proxy-url");
    frame.src = url;
    void callbacks.onNavigate?.(url);
  }

  async tryProxyFallback(frame: BrowserSurfaceElement, url: string, callbacks: BrowserSurfaceCallbacks): Promise<boolean> {
    if (this.isElectronWebview(frame) || !/^https?:\/\//i.test(url)) return false;
    if (frame.dataset.mwvProxyUrl === url) return false;
    const doc = await this.fetchLiveDocument(url);
    if (!doc || !frame.isConnected || !this.isEmbedBlockedByHeaders(doc.headers)) return false;
    this.wireProxyBridge(frame, callbacks);
    this.renderProxyDocument(frame, url, doc.text, callbacks);
    void callbacks.onNavigate?.(url);
    return true;
  }

  proxyClearFind(frame: BrowserSurfaceElement | null | undefined): void {
    if (!frame || this.isElectronWebview(frame)) return;
    try {
      frame.contentWindow?.postMessage({ mwvClearFind: true }, "*");
    } catch {
      // Frame not ready or already gone.
    }
  }

  async proxyFindInFrame(frame: BrowserSurfaceElement, query: string, direction: number): Promise<number> {
    if (this.isElectronWebview(frame) || !frame.contentWindow) return 0;
    const requestId = ++this.proxyFindSeq;
    const result = await new Promise<number>((resolve) => {
      this.proxyFindResolvers.set(requestId, resolve);
      try {
        frame.contentWindow?.postMessage({ mwvFind: query, mwvDir: direction, requestId }, "*");
      } catch {
        this.proxyFindResolvers.delete(requestId);
        resolve(0);
        return;
      }
      window.setTimeout(() => {
        if (this.proxyFindResolvers.has(requestId)) {
          this.proxyFindResolvers.delete(requestId);
          resolve(0);
        }
      }, 1500);
    });
    return result;
  }

  openInSystemBrowser(url: string): void {
    const clean = normalizeInput(url, this.settings.searchUrl);
    if (!clean) return;
    try {
      const opened = window.open(clean, "_system");
      if (!opened) window.open(clean, "_blank");
    } catch {
      window.open(clean, "_blank");
    }
    void this.addConsole("info", "Opened in system browser", clean);
  }

  createBrowserSurface(
    parent: HTMLElement,
    url: string,
    className: string,
    title: string,
    callbacks: BrowserSurfaceCallbacks = {}
  ): BrowserSurfaceElement {
    if (this.supportsElectronWebview()) {
      const webview = parent.ownerDocument.createElement("webview") as ElectronWebviewElement;
      webview.addClass(className);
      webview.addClass("mwv-real-webview");
      if (callbacks.raw) webview.addClass("mwv-raw-surface");
      webview.setAttribute("title", title);
      webview.setAttribute("allowpopups", "true");
      webview.setAttribute("partition", this.settings.incognitoMode ? `temp:mwv-${Date.now()}` : "persist:mobile-webviewer");
      webview.setAttribute("webpreferences", this.buildWebviewPreferences());
      this.applyBrowserSurfaceUserAgent(webview, url);
      // Cached pages can emit dom-ready immediately after insertion. Attach
      // every lifecycle listener before src/append so readiness is never lost.
      this.bindRealBrowserSurface(webview, callbacks);
      if (url) webview.src = url;
      parent.appendChild(webview);
      return webview;
    }

    const frame = parent.createEl("iframe", {
      cls: callbacks.raw ? `${className} mwv-raw-surface` : className,
      attr: {
        title,
        sandbox: this.buildFrameSandbox(className.includes("mwv-live-frame")),
        referrerpolicy: "strict-origin-when-cross-origin"
      }
    });
    if (url) void this.smartLoadBrowserFrame(frame, url, callbacks);
    let settled = false;
    const loadTimer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      void callbacks.onFail?.("Live frame timed out; using internal reader fallback", frame.src || url);
    }, 12000);
    frame.addEventListener("load", () => {
      settled = true;
      window.clearTimeout(loadTimer);
      void callbacks.onReady?.();
      window.setTimeout(async () => {
        if (!frame.isConnected) return;
        const currentUrl = frame.dataset.mwvProxyUrl || frame.src || url;
        let readable = false;
        let readableButEmpty = false;
        try {
          const doc = frame.contentDocument;
          readable = Boolean(doc?.body);
          readableButEmpty = readable && !doc?.body.innerText.trim() && !doc?.body.children.length;
        } catch {
          // A normal cross-origin page is also unreadable from the host; do not treat that as failed.
          readable = false;
        }
        if (readableButEmpty && /^https?:\/\//i.test(currentUrl)) {
          // Site refused embedding at load time (header probe missed it or the
          // page redirected): switch to the built-in proxy instead of showing
          // net::ERR_BLOCKED_BY_RESPONSE to the user.
          const proxied = await this.tryProxyFallback(frame, currentUrl, callbacks);
          if (proxied) return;
          void callbacks.onFail?.("Live frame blocked; using internal reader fallback", currentUrl);
        }
      }, 900);
      try {
        const frameTitle = frame.contentDocument?.title;
        if (frameTitle) void callbacks.onTitle?.(frameTitle);
      } catch {
        // Cross-origin iframe title is not readable.
      }
    });
    frame.addEventListener("error", () => {
      settled = true;
      window.clearTimeout(loadTimer);
      void callbacks.onFail?.("Live frame failed; using internal reader fallback", frame.src || url);
    });
    return frame;
  }

  buildWebviewPreferences(): string {
    const preferences = [
      "contextIsolation=yes",
      "nativeWindowOpen=yes",
      "sandbox=yes",
      this.settings.jsDisabled ? "javascript=no" : "javascript=yes"
    ];
    return preferences.join(",");
  }

  safeWebviewUrl(webview: ElectronWebviewElement): string {
    if (webview._mwvReady !== true || webview._mwvDestroyed === true) {
      return webview.dataset.mwvPendingUrl || webview.src || "";
    }
    try {
      return webview.getURL?.() || webview.src || "";
    } catch {
      return webview.src || "";
    }
  }

  safeBrowserSurfaceUrl(surface: BrowserSurfaceElement | null | undefined): string {
    if (!surface) return "";
    return this.isElectronWebview(surface) ? this.safeWebviewUrl(surface) : surface.src || "";
  }

  safeWebviewTitle(webview: ElectronWebviewElement): string {
    if (webview._mwvReady !== true || webview._mwvDestroyed === true) return "";
    try {
      return webview.getTitle?.() || "";
    } catch {
      return "";
    }
  }

  bindRealBrowserSurface(webview: ElectronWebviewElement, callbacks: BrowserSurfaceCallbacks): void {
    webview._mwvReady = false;
    webview._mwvDestroyed = false;
    const emitNavigate = (event: Event) => {
      if (!this.isBrowserSurfaceReady(webview)) return;
      const detail = event as Event & { url?: string };
      const url = detail.url || this.safeWebviewUrl(webview);
      const downloadUrl = this.extractInternalDownloadUrl(url);
      if (downloadUrl) {
        webview.stop?.();
        void callbacks.onDownloadCandidate?.(downloadUrl);
        return;
      }
      if (url) void callbacks.onNavigate?.(url);
    };
    const emitTitle = (event: Event) => {
      if (!this.isBrowserSurfaceReady(webview)) return;
      const detail = event as Event & { title?: string };
      const title = detail.title || this.safeWebviewTitle(webview);
      if (title) void callbacks.onTitle?.(title);
    };

    const keepGuestUntouched = callbacks.raw === true;
    const listeners: Array<[string, EventListener]> = [];
    const listen = (type: string, handler: EventListener) => {
      webview.addEventListener(type, handler);
      listeners.push([type, handler]);
    };
    const onDomReady: EventListener = () => {
      if (!webview.isConnected || webview._mwvDestroyed) return;
      webview._mwvReady = true;
      const pendingUrl = webview.dataset.mwvPendingUrl;
      delete webview.dataset.mwvPendingUrl;
      if (pendingUrl && pendingUrl !== "about:blank" && webview.src !== pendingUrl) {
        try {
          if (webview.loadURL) webview.loadURL(pendingUrl);
          else webview.src = pendingUrl;
        } catch {
          // A WebContents destroyed during startup must not bubble an error.
        }
      }
      if (!keepGuestUntouched) {
        void this.applyWebviewRuntime(webview);
        this.installWebviewBrowserBridge(webview, callbacks);
      }
      void callbacks.onReady?.();
      const title = this.safeWebviewTitle(webview);
      if (title) void callbacks.onTitle?.(title);
    };
    listen("dom-ready", onDomReady);
    listen("did-start-navigation", ((event: Event) => {
      if (!this.isBrowserSurfaceReady(webview)) return;
      const detail = event as Event & { url?: string; isMainFrame?: boolean; preventDefault?: () => void };
      const url = detail.url || "";
      const downloadUrl = this.extractInternalDownloadUrl(url);
      if (downloadUrl) {
        detail.preventDefault?.();
        webview.stop?.();
        void callbacks.onDownloadCandidate?.(downloadUrl);
        return;
      }
      if (detail.isMainFrame !== false && looksLikeDownloadUrl(url)) {
        detail.preventDefault?.();
        webview.stop?.();
        void callbacks.onDownloadCandidate?.(url);
      }
    }) as EventListener);
    listen("will-navigate", ((event: Event) => {
      if (!this.isBrowserSurfaceReady(webview)) return;
      const detail = event as Event & { url?: string; preventDefault?: () => void };
      const url = detail.url || "";
      const downloadUrl = this.extractInternalDownloadUrl(url);
      if (downloadUrl) {
        detail.preventDefault?.();
        void callbacks.onDownloadCandidate?.(downloadUrl);
        return;
      }
      if (looksLikeDownloadUrl(url)) {
        detail.preventDefault?.();
        void callbacks.onDownloadCandidate?.(url);
      }
    }) as EventListener);
    listen("did-start-loading", (() => {
      if (!this.isBrowserSurfaceReady(webview)) return;
      webview.removeClass("has-load-error");
      void callbacks.onLoading?.(true, this.safeWebviewUrl(webview));
    }) as EventListener);
    listen("did-stop-loading", (() => {
        if (!this.isBrowserSurfaceReady(webview)) return;
        void callbacks.onLoading?.(false, this.safeWebviewUrl(webview));
    }) as EventListener);
    listen("did-navigate", emitNavigate as EventListener);
    listen("did-navigate-in-page", emitNavigate as EventListener);
    listen("page-title-updated", emitTitle as EventListener);
    listen("page-favicon-updated", ((event: Event) => {
      if (!this.isBrowserSurfaceReady(webview)) return;
      const detail = event as Event & { favicons?: string[] };
      const favicon = detail.favicons?.find(Boolean);
      if (favicon) void callbacks.onFavicon?.(favicon);
    }) as EventListener);
    listen("did-finish-load", (() => {
      if (!this.isBrowserSurfaceReady(webview)) return;
      webview.removeClass("has-load-error");
      const url = this.safeWebviewUrl(webview);
      if (url) void callbacks.onNavigate?.(url);
      const title = this.safeWebviewTitle(webview);
      if (title) void callbacks.onTitle?.(title);
    }) as EventListener);
    listen("did-fail-load", ((event: Event) => {
      if (!this.isBrowserSurfaceReady(webview)) return;
      const detail = event as Event & {
        errorDescription?: string;
        validatedURL?: string;
        errorCode?: number;
        isMainFrame?: boolean;
      };
      if (detail.errorCode === -3) return;
      // A real page routinely contains third-party frames that fail or are
      // blocked independently of the top-level document. Treating those
      // failures as a page failure replaces the already-rendered raw page
      // with the reader fallback a moment after first paint.
      if (detail.isMainFrame === false) return;
      webview.addClass("has-load-error");
      void callbacks.onFail?.(detail.errorDescription || "Load failed", detail.validatedURL || this.safeWebviewUrl(webview));
    }) as EventListener);
    listen("console-message", ((event: Event) => {
      if (!this.isBrowserSurfaceReady(webview)) return;
      const detail = event as Event & { message?: string; level?: number };
      const bridgePrefix = "__MWV_BRIDGE__";
      if (typeof detail.message === "string" && detail.message.startsWith(bridgePrefix)) {
        try {
          const payload = JSON.parse(detail.message.slice(bridgePrefix.length)) as { kind?: string; url?: string; title?: string };
          if (payload.kind === "new-window" && payload.url) {
            void callbacks.onNewWindow?.(payload.url);
            return;
          }
          if (payload.kind === "download" && payload.url) {
            void callbacks.onDownloadCandidate?.(payload.url);
            return;
          }
          if (payload.kind === "context-link" && payload.url) {
            void callbacks.onContextLink?.(payload.url, payload.title || "");
            return;
          }
          if (payload.kind === "webnote" && payload.url) {
            void callbacks.onWebNotePatch?.(payload as BrowserWebNotePatch);
            return;
          }
        } catch {
          // Fall through to normal console logging.
        }
      }
      const level = detail.level === 2 ? "error" : detail.level === 1 ? "warn" : "info";
      if (detail.message) void callbacks.onConsole?.(level, detail.message, this.safeWebviewUrl(webview));
    }) as EventListener);
    listen("new-window", ((event: Event) => {
      if (!this.isBrowserSurfaceReady(webview)) return;
      const detail = event as Event & { url?: string; preventDefault?: () => void };
      if (!detail.url) return;
      detail.preventDefault?.();
      void callbacks.onNewWindow?.(detail.url);
    }) as EventListener);
    listen("ipc-message", ((event: Event) => {
      if (!this.isBrowserSurfaceReady(webview)) return;
      const detail = event as Event & { channel?: string; args?: unknown[] };
      if (detail.channel !== "mwv-browser-bridge") return;
      const [kind, url, title] = detail.args ?? [];
      if (typeof kind !== "string" || typeof url !== "string" || !url) return;
      if (kind === "new-window") {
        void callbacks.onNewWindow?.(url);
      } else if (kind === "download") {
        void callbacks.onDownloadCandidate?.(url);
      } else if (kind === "context-link") {
        void callbacks.onContextLink?.(url, typeof title === "string" ? title : "");
      } else if (kind === "webnote") {
        void callbacks.onWebNotePatch?.({
          url,
          title: typeof title === "string" ? title : "",
          noteHtml: typeof detail.args?.[3] === "string" ? detail.args[3] : "",
          noteText: typeof detail.args?.[4] === "string" ? detail.args[4] : "",
          doodleSvg: typeof detail.args?.[5] === "string" ? detail.args[5] : "",
          noteEdited: detail.args?.[6] === true,
          doodleEdited: detail.args?.[7] === true,
          pageEdited: detail.args?.[8] === true
        });
      }
    }) as EventListener);
    listen("destroyed", (() => {
      webview._mwvDestroyed = true;
      webview._mwvReady = false;
      webview._mwvDispose?.();
    }) as EventListener);
    webview._mwvDispose = () => {
      for (const [type, handler] of listeners) webview.removeEventListener(type, handler);
      listeners.length = 0;
    };
  }

  installWebviewBrowserBridge(webview: ElectronWebviewElement, callbacks: BrowserSurfaceCallbacks): void {
    if (!webview.executeJavaScript) return;
    const code = `
      (() => {
        const cleanupLegacyWebNoteOverlay = () => {
          const doc = document;
          doc.getElementById("mwv-page-note-root")?.remove();
          doc.getElementById("mwv-page-note-style")?.remove();
          doc.documentElement.classList.remove("mwv-page-text-editing");
          doc.querySelectorAll("[data-mwv-prev-contenteditable]").forEach((element) => {
            const previous = element.getAttribute("data-mwv-prev-contenteditable") || "";
            element.removeAttribute("data-mwv-prev-contenteditable");
            if (previous) element.setAttribute("contenteditable", previous);
            else element.removeAttribute("contenteditable");
          });
          try { document.designMode = "off"; } catch (error) {}
          try { delete window.__mwvApplyPageNote; } catch (error) { window.__mwvApplyPageNote = undefined; }
          try { delete window.__mwvFlushPageNote; } catch (error) { window.__mwvFlushPageNote = undefined; }
        };
        cleanupLegacyWebNoteOverlay();
        if (window.__mwvBrowserBridgeInstalled) return;
        window.__mwvBrowserBridgeInstalled = true;
        const filePattern = ${BINARY_URL_PATTERN.toString()};
        const send = (kind, url, title, extras) => {
          try {
            console.info("__MWV_BRIDGE__" + JSON.stringify({ kind, url, title: title || "", ...(extras || {}) }));
            return true;
          } catch (error) {}
          if (kind === "download") {
            window.location.href = "obsidian://mobile-webviewer-download?url=" + encodeURIComponent(url);
            return true;
          }
          return kind === "new-window";
        };
        const originalOpen = window.open;
        window.open = function(url, target, features) {
          if (url && typeof url === "string" && (!target || target === "_blank")) {
            send("new-window", new URL(url, location.href).href, "");
            return null;
          }
          return originalOpen ? originalOpen.apply(window, arguments) : null;
        };
        document.addEventListener("click", (event) => {
          const anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
          if (!anchor) return;
          const href = anchor.href || "";
          if (!href || href.startsWith("javascript:") || href.startsWith("#")) return;
          const shouldDownload = anchor.hasAttribute("download") || filePattern.test(href);
          if (shouldDownload) {
            event.preventDefault();
            event.stopPropagation();
            send("download", href, anchor.textContent || "");
            return;
          }
          const target = (anchor.getAttribute("target") || "").toLowerCase();
          if (target === "_blank") {
            event.preventDefault();
            event.stopPropagation();
            send("new-window", href, anchor.textContent || "");
          }
        }, true);
        document.addEventListener("contextmenu", (event) => {
          const anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
          if (anchor && anchor.href) send("context-link", anchor.href, anchor.textContent || "");
        }, true);
        document.addEventListener("mouseover", (event) => {
          const anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
          if (anchor && anchor.href) send("context-link", anchor.href, anchor.textContent || "");
        }, true);
        const installWebNoteOverlay = () => {
          const doc = document;
          if (doc.getElementById("mwv-page-note-root")) return;
          const style = doc.createElement("style");
          style.id = "mwv-page-note-style";
          style.textContent = \`
            html.mwv-page-text-editing [contenteditable="true"]:not(#mwv-page-note-editor){outline:2px solid rgba(37,99,235,.35);outline-offset:2px;}
            #mwv-page-note-root{position:absolute;top:0;left:0;right:0;height:var(--mwv-page-note-height,100vh);z-index:2147483000;pointer-events:none;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
            #mwv-page-note-bar{display:none!important;pointer-events:none;}
            #mwv-page-note-bar button{width:34px;height:34px;border:1px solid rgba(120,120,120,.32);border-radius:10px;background:rgba(255,255,255,.92);color:#111827;box-shadow:0 6px 18px rgba(0,0,0,.18);font:600 12px system-ui;}
            #mwv-page-note-bar button.is-active{background:#2563eb;color:#fff;}
            #mwv-page-note-panel{display:none;pointer-events:auto;box-sizing:border-box;margin:10px auto 0;max-width:min(760px,calc(100vw - 24px));padding:12px;border:1px solid rgba(120,120,120,.28);border-radius:12px;background:rgba(255,255,255,.96);box-shadow:0 14px 40px rgba(0,0,0,.22);color:#111827;}
            #mwv-page-note-root.is-note-open #mwv-page-note-panel{display:block;}
            #mwv-page-note-editor{min-height:96px;max-height:45vh;overflow:auto;outline:0;white-space:normal;line-height:1.55;font-size:15px;}
            #mwv-page-note-editor:empty::before{content:"网页笔记";color:#6b7280;}
            #mwv-page-note-canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;}
            #mwv-page-note-root.is-drawing #mwv-page-note-canvas{pointer-events:auto;}
            @media (prefers-color-scheme:dark){
              #mwv-page-note-bar button{background:rgba(24,24,27,.92);color:#f8fafc;border-color:rgba(255,255,255,.18);}
              #mwv-page-note-panel{background:rgba(24,24,27,.96);color:#f8fafc;border-color:rgba(255,255,255,.16);}
            }
          \`;
          doc.documentElement.appendChild(style);
          const root = doc.createElement("div");
          root.id = "mwv-page-note-root";
          root.setAttribute("data-url", location.href);
          const bar = doc.createElement("div");
          bar.id = "mwv-page-note-bar";
          bar.hidden = true;
          bar.setAttribute("aria-hidden", "true");
          const noteButton = doc.createElement("button");
          noteButton.type = "button";
          noteButton.textContent = "T";
          noteButton.title = "Edit page note";
          const textButton = doc.createElement("button");
          textButton.type = "button";
          textButton.textContent = "A";
          textButton.title = "Edit page text";
          const drawButton = doc.createElement("button");
          drawButton.type = "button";
          drawButton.textContent = "✎";
          drawButton.title = "Doodle on page";
          bar.append(noteButton, textButton, drawButton);
          const panel = doc.createElement("div");
          panel.id = "mwv-page-note-panel";
          const editor = doc.createElement("div");
          editor.id = "mwv-page-note-editor";
          editor.contentEditable = "true";
          editor.spellcheck = true;
          panel.appendChild(editor);
          const canvas = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
          canvas.id = "mwv-page-note-canvas";
          canvas.setAttribute("viewBox", "0 0 1000 1000");
          canvas.setAttribute("preserveAspectRatio", "none");
          root.append(bar, panel, canvas);
          doc.body.prepend(root);
          let saveTimer = 0;
          let textEditEnabled = false;
          let pageEdited = false;
          let noteEdited = false;
          let doodleEdited = false;
          let pageSaveTimer = 0;
          let appliedSavedPageHtml = false;
          const resize = () => {
            const height = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight, window.innerHeight);
            root.style.setProperty("--mwv-page-note-height", height + "px");
          };
          const pageSnapshot = () => {
            const clone = doc.body.cloneNode(true);
            if (clone && clone.querySelector) {
              clone.querySelector("#mwv-page-note-root")?.remove();
              clone.querySelectorAll("[data-mwv-prev-contenteditable]").forEach((el) => {
                const previous = el.getAttribute("data-mwv-prev-contenteditable") || "";
                el.removeAttribute("data-mwv-prev-contenteditable");
                if (previous) el.setAttribute("contenteditable", previous);
                else el.removeAttribute("contenteditable");
              });
            }
            return {
              html: clone && "innerHTML" in clone ? clone.innerHTML : "",
              text: clone && "innerText" in clone ? clone.innerText || "" : doc.body.innerText || ""
            };
          };
          const sendNote = () => {
            resize();
            const snapshot = appliedSavedPageHtml || textEditEnabled || pageEdited ? pageSnapshot() : { html: "", text: "" };
            send("webnote", location.href, document.title || location.hostname, {
              noteHtml: editor.innerHTML,
              noteText: editor.innerText || "",
              doodleSvg: canvas.innerHTML,
              pageHtml: snapshot.html,
              pageText: snapshot.text,
              noteEdited,
              doodleEdited,
              pageEdited
            });
          };
          window.__mwvFlushPageNote = () => {
            finish();
            if (textEditEnabled) {
              pageEdited = true;
            }
            sendNote();
          };
          const queueSave = () => {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(sendNote, 450);
          };
          const pageEditableTargets = () => Array.from(doc.body.querySelectorAll("main,article,section,p,li,h1,h2,h3,h4,h5,h6,blockquote,figcaption,td,th,span,div"))
            .filter((el) => !root.contains(el) && el.nodeType === 1 && (el.innerText || "").trim().length > 0)
            .slice(0, 900);
          const setPageTextEditing = (enabled) => {
            const wasEditing = textEditEnabled;
            textEditEnabled = enabled;
            doc.documentElement.classList.toggle("mwv-page-text-editing", enabled);
            document.designMode = enabled ? "on" : "off";
            for (const el of pageEditableTargets()) {
              if (enabled) {
                if (!el.hasAttribute("data-mwv-prev-contenteditable")) {
                  el.setAttribute("data-mwv-prev-contenteditable", el.getAttribute("contenteditable") || "");
                }
                el.setAttribute("contenteditable", "true");
              } else if (el.hasAttribute("data-mwv-prev-contenteditable")) {
                const previous = el.getAttribute("data-mwv-prev-contenteditable") || "";
                el.removeAttribute("data-mwv-prev-contenteditable");
                if (previous) el.setAttribute("contenteditable", previous);
                else el.removeAttribute("contenteditable");
              }
            }
            textButton.classList.toggle("is-active", enabled);
            if (!enabled && wasEditing) {
              pageEdited = true;
              sendNote();
            }
          };
          noteButton.addEventListener("click", (event) => {
            event.preventDefault();
            root.classList.toggle("is-note-open");
            noteButton.classList.toggle("is-active", root.classList.contains("is-note-open"));
            if (root.classList.contains("is-note-open")) editor.focus();
          });
          textButton.addEventListener("click", (event) => {
            event.preventDefault();
            setPageTextEditing(!textEditEnabled);
          });
          drawButton.addEventListener("click", (event) => {
            event.preventDefault();
            root.classList.toggle("is-drawing");
            drawButton.classList.toggle("is-active", root.classList.contains("is-drawing"));
            queueSave();
          });
          editor.addEventListener("input", () => {
            noteEdited = true;
            queueSave();
          }, true);
          editor.addEventListener("blur", () => {
            if (editor.innerHTML.trim() || noteEdited) {
              noteEdited = true;
              sendNote();
            }
          }, true);
          document.addEventListener("input", (event) => {
            if (!textEditEnabled || root.contains(event.target)) return;
            pageEdited = true;
            clearTimeout(pageSaveTimer);
            pageSaveTimer = setTimeout(sendNote, 700);
          }, true);
          document.addEventListener("blur", (event) => {
            if (!textEditEnabled || root.contains(event.target)) return;
            sendNote();
          }, true);
          window.__mwvApplyPageNote = (payload) => {
            if (!payload) return;
            const nextEditor = document.getElementById("mwv-page-note-editor");
            const nextCanvas = document.getElementById("mwv-page-note-canvas");
            if (nextEditor && typeof payload.noteHtml === "string" && payload.noteHtml && !nextEditor.innerHTML.trim()) nextEditor.innerHTML = payload.noteHtml;
            if (nextCanvas && typeof payload.doodleSvg === "string" && payload.doodleSvg && !nextCanvas.innerHTML.trim()) nextCanvas.innerHTML = payload.doodleSvg;
            resize();
          };
          let activePath = null;
          let activePointer = null;
          const point = (event) => {
            const rect = canvas.getBoundingClientRect();
            return [
              Math.max(0, Math.min(1000, ((event.clientX - rect.left) / Math.max(1, rect.width)) * 1000)),
              Math.max(0, Math.min(1000, ((event.clientY - rect.top) / Math.max(1, rect.height)) * 1000))
            ];
          };
          const finish = (event) => {
            if (!activePath) return;
            const pointerId = activePointer || (event && event.pointerId);
            activePath = null;
            activePointer = null;
            try {
              if (typeof pointerId === "number" && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
            } catch (error) {}
            sendNote();
          };
          canvas.addEventListener("pointerdown", (event) => {
            if (!root.classList.contains("is-drawing")) return;
            if (event.pointerType === "mouse" && event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            resize();
            finish(event);
            const [x,y] = point(event);
            const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", "M " + x.toFixed(1) + " " + y.toFixed(1));
            path.setAttribute("fill", "none");
            path.setAttribute("stroke", "#2563eb");
            path.setAttribute("stroke-width", "5");
            path.setAttribute("stroke-linecap", "round");
            path.setAttribute("stroke-linejoin", "round");
            canvas.appendChild(path);
            doodleEdited = true;
            activePath = path;
            activePointer = event.pointerId;
            try { canvas.setPointerCapture(event.pointerId); } catch (error) {}
          }, true);
          canvas.addEventListener("pointermove", (event) => {
            if (!root.classList.contains("is-drawing") || !activePath || activePointer !== event.pointerId) return;
            event.preventDefault();
            event.stopPropagation();
            const [x,y] = point(event);
            activePath.setAttribute("d", activePath.getAttribute("d") + " L " + x.toFixed(1) + " " + y.toFixed(1));
            queueSave();
          }, true);
          canvas.addEventListener("pointerup", finish, true);
          canvas.addEventListener("pointercancel", finish, true);
          canvas.addEventListener("pointerleave", finish, true);
          canvas.addEventListener("lostpointercapture", finish, true);
          window.addEventListener("resize", resize, true);
          window.addEventListener("blur", () => window.__mwvFlushPageNote && window.__mwvFlushPageNote(), true);
          window.addEventListener("pagehide", () => window.__mwvFlushPageNote && window.__mwvFlushPageNote(), true);
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState !== "visible") window.__mwvFlushPageNote && window.__mwvFlushPageNote();
          }, true);
          window.addEventListener("beforeunload", () => {
            setPageTextEditing(false);
            window.__mwvFlushPageNote && window.__mwvFlushPageNote();
          }, true);
          resize();
        };
        const doc = document;
        if (doc.body) cleanupLegacyWebNoteOverlay();
        else document.addEventListener("DOMContentLoaded", cleanupLegacyWebNoteOverlay, { once: true });
      })();
    `;
    webview.executeJavaScript(code, false).catch(() => {
      void callbacks.onConsole?.("warn", "Browser bridge injection failed", this.safeWebviewUrl(webview));
    });
  }

  extractInternalDownloadUrl(url: string | undefined): string {
    if (!url) return "";
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "obsidian:" || parsed.hostname !== "mobile-webviewer-download") return "";
      return parsed.searchParams.get("url") || "";
    } catch {
      return "";
    }
  }

  setBrowserSurfaceUrl(surface: BrowserSurfaceElement, url: string): void {
    if (this.isElectronWebview(surface)) {
      if (surface._mwvDestroyed === true || !surface.isConnected) return;
      // The UA must be selected before the main document request. Bing's
      // legacy mobile variant otherwise returns a malformed homepage even
      // though all of its stylesheets load successfully.
      this.applyBrowserSurfaceUserAgent(surface, url);
      if (!this.isBrowserSurfaceReady(surface)) {
        surface.dataset.mwvPendingUrl = url;
        // Setting the declarative src is safe before dom-ready and lets the
        // guest perform its first navigation. Do not call loadURL until the
        // element has announced that its WebContents is ready.
        try {
          surface.src = url;
        } catch {
          // The element may already be tearing down; the disposed guard below
          // prevents a later callback from touching it.
        }
        return;
      }
      delete surface.dataset.mwvPendingUrl;
      if (surface.loadURL) {
        surface.loadURL(url);
      } else {
        surface.src = url;
      }
      return;
    }
    surface.src = url;
  }

  getBrowserSurfaceTitle(surface: BrowserSurfaceElement): string {
    if (this.isElectronWebview(surface)) {
      if (!this.isBrowserSurfaceReady(surface)) return "";
      return surface.getTitle?.() || "";
    }
    try {
      return surface.contentDocument?.title || "";
    } catch {
      return "";
    }
  }

  describeBrowserSurface(surface: BrowserSurfaceElement | undefined, fallbackUrl: string): string[] {
    const isWebview = this.isElectronWebview(surface);
    const currentUrl = surface
      ? this.isElectronWebview(surface)
        ? this.safeWebviewUrl(surface) || fallbackUrl
        : surface.src || fallbackUrl
      : fallbackUrl;
    const rows = [
      `内核: ${isWebview ? "Electron Chromium webview" : surface ? "iframe fallback" : "未找到页面层"}`,
      `当前地址: ${currentUrl}`,
      `标题: ${surface ? this.getBrowserSurfaceTitle(surface) || hostName(currentUrl) : hostName(currentUrl)}`,
      `加载中: ${isWebview && this.isBrowserSurfaceReady(surface) && surface.isLoading?.() ? "是" : "否"}`,
      `可后退: ${isWebview && this.isBrowserSurfaceReady(surface) && surface.canGoBack?.() ? "是" : "否"}`,
      `可前进: ${isWebview && this.isBrowserSurfaceReady(surface) && surface.canGoForward?.() ? "是" : "否"}`,
      `缩放: ${this.settings.pageZoom}%`,
      `页面模式: ${this.settings.userAgentMode} / ${this.settings.desktopMode ? "desktop width" : "mobile width"}`,
      `下载目录: ${this.normalizeDownloadFolder()}`
    ];
    return rows;
  }

  async openBrowserDevTools(surface?: BrowserSurfaceElement): Promise<boolean> {
    if (!this.isBrowserSurfaceReady(surface) || !this.isElectronWebview(surface) || typeof surface.openDevTools !== "function") {
      await this.addConsole("warn", "DevTools unavailable on current browser surface");
      return false;
    }
    try {
      surface.openDevTools();
      await this.addConsole("info", "Opened webview DevTools", this.safeWebviewUrl(surface));
      return true;
    } catch (error) {
      await this.addConsole("error", `Open DevTools failed: ${error instanceof Error ? error.message : String(error)}`, this.safeWebviewUrl(surface));
      return false;
    }
  }

  private mobileWebviewerCapabilities(): Record<string, unknown> {
    return {
      id: this.manifest.id,
      name: this.manifest.name,
      pluginVersion: this.manifest.version,
      apiVersion: MOBILE_WEBVIEWER_API_VERSION,
      methods: [
        "getCapabilities",
        "getStatus",
        "getCurrentContext",
        "getSelection",
        "readPage",
        "open",
        "listTabs",
        "newTab",
        "switchTab",
        "closeTab",
        "toggleBookmark",
        "addToReadingList",
        "sendToCancip",
        "subscribe"
      ],
      context: ["url", "title", "selection", "reader text", "reader html", "images", "links"],
      events: ["navigate", "tab-change", "tab-close", "bookmark-change", "reading-list-change"],
      cancip: this.getCancipStatus()
    };
  }

  private mobileWebviewerStatus(): Record<string, unknown> {
    const active = this.resolveActiveWebContextTarget();
    return {
      id: this.manifest.id,
      pluginVersion: this.manifest.version,
      apiVersion: MOBILE_WEBVIEWER_API_VERSION,
      active: Boolean(active.view || active.embed),
      source: active.view ? "view" : active.embed ? "embed" : "settings",
      url: active.url,
      title: active.title,
      activeTabId: active.tabId,
      tabs: this.settings.browserTabs.length,
      bookmarks: this.settings.bookmarks.filter((entry) => !isBuiltInShortcut(entry)).length,
      readingList: this.settings.readingList.length,
      cancip: this.getCancipStatus()
    };
  }

  private resolveActiveWebContextTarget(): {
    view: MobileWebviewerView | null;
    embed: HTMLElement | null;
    url: string;
    title: string;
    tabId: string;
  } {
    const activeLeaf = this.app.workspace.activeLeaf ?? this.app.workspace.getMostRecentLeaf();
    const activeView = activeLeaf?.view instanceof MobileWebviewerView ? activeLeaf.view : null;
    const activeContainer = (activeLeaf?.view as { containerEl?: HTMLElement } | undefined)?.containerEl;
    const activeEmbeds = activeContainer
      ? Array.from(activeContainer.querySelectorAll<HTMLElement>(".mwv-embed[data-url]"))
      : [];
    const visibleEmbed = activeEmbeds.find((embed) => {
      const rect = embed.getBoundingClientRect();
      return embed.isConnected && rect.width > 0 && rect.height > 0;
    }) ?? activeEmbeds[0] ?? null;
    const fallbackView = this.app.workspace.getLeavesOfType(VIEW_TYPE)
      .map((leaf) => leaf.view)
      .find((view): view is MobileWebviewerView => view instanceof MobileWebviewerView) ?? null;
    const view = activeView ?? (visibleEmbed ? null : fallbackView);
    const embed = activeView ? null : visibleEmbed;
    const tabId = view?.activeBrowserTabId
      || embed?.dataset.mwvActiveTabId
      || this.settings.activeBrowserTabId;
    const tab = this.settings.browserTabs.find((entry) => entry.id === tabId)
      ?? this.settings.browserTabs[0]
      ?? this.createBrowserTab(this.settings.homeUrl);
    const rawUrl = view?.currentUrl || embed?.dataset.url || tab.url || this.settings.noteBrowserUrl || this.settings.homeUrl;
    const url = internalUtilityContextUrl(rawUrl) || rawUrl;
    const title = view?.currentTitle
      || embed?.dataset.mwvTitle
      || tab.title
      || hostName(url);
    return { view, embed, url, title, tabId: tab.id };
  }

  private async selectionFromSurface(surface?: BrowserSurfaceElement | null): Promise<string> {
    if (!surface) return "";
    if (this.isBrowserSurfaceReady(surface) && this.isElectronWebview(surface) && surface.executeJavaScript) {
      try {
        const selected = await surface.executeJavaScript("window.getSelection ? String(window.getSelection() || '') : ''", false);
        return typeof selected === "string" ? selected.trim() : "";
      } catch {
        return "";
      }
    }
    try {
      return (surface as HTMLIFrameElement).contentWindow?.getSelection?.()?.toString().trim() ?? "";
    } catch {
      return "";
    }
  }

  private selectionWithin(root?: HTMLElement | null): string {
    if (!root) return "";
    const selection = root.ownerDocument.getSelection();
    const anchor = selection?.anchorNode;
    if (!selection || !anchor || !root.contains(anchor)) return "";
    return selection.toString().trim();
  }

  async getCurrentWebSelection(): Promise<{ text: string; url: string; title: string }> {
    const target = this.resolveActiveWebContextTarget();
    const root = target.view
      ? target.view.containerEl
      : target.embed;
    let text = this.selectionWithin(root);
    if (!text && target.view?.surfaceEl) text = await this.selectionFromSurface(target.view.surfaceEl);
    if (!text && target.embed) {
      text = await this.selectionFromSurface(target.embed.querySelector<BrowserSurfaceElement>(".mwv-live-frame"));
    }
    return { text, url: target.url, title: target.title };
  }

  async getCurrentWebContext(options: MobileWebviewerContextOptions = {}): Promise<MobileWebviewerContext> {
    const target = this.resolveActiveWebContextTarget();
    const maxChars = clampNumber(Math.round(options.maxChars ?? 40000), 1000, 200000);
    const includeContent = options.includeContent !== false;
    const includeSelection = options.includeSelection !== false;
    const selectedText = includeSelection ? (await this.getCurrentWebSelection()).text.slice(0, maxChars) : "";
    let page: NotePage | null = null;
    let html = "";

    const cached = this.getCachedPage(target.url);
    if (target.view?.currentWebNote && target.view.currentWebNote.url === target.url) {
      const note = target.view.currentWebNote;
      page = {
        title: note.sourceTitle || note.title || target.title,
        url: note.url,
        byline: cached?.byline || hostName(note.url),
        excerpt: (note.noteText || note.pageText || cached?.excerpt || "").slice(0, 420),
        images: cached?.images ?? [],
        content: note.noteText || note.pageText,
        links: cached?.links ?? []
      };
      html = note.pageHtml || note.noteHtml;
    }
    if (!page && cached) page = cached;
    if (includeContent && /^https?:\/\//i.test(target.url) && (!page || options.refresh)) {
      const previousCache = options.refresh ? [...this.settings.pageCache] : null;
      if (previousCache) this.settings.pageCache = this.settings.pageCache.filter((entry) => entry.url !== target.url);
      try {
        page = await this.fetchNotePage(target.url);
      } catch (error) {
        if (previousCache) this.settings.pageCache = previousCache;
        await this.addConsole("warn", `API reader extraction skipped: ${error instanceof Error ? error.message : String(error)}`, target.url);
      }
    }

    return {
      apiVersion: MOBILE_WEBVIEWER_API_VERSION,
      pluginVersion: this.manifest.version,
      url: target.url,
      title: page?.title || target.title,
      tabId: target.tabId,
      source: target.view ? "view" : target.embed ? "embed" : "settings",
      selectedText,
      byline: page?.byline ?? "",
      excerpt: page?.excerpt?.slice(0, Math.min(maxChars, 1200)) ?? "",
      content: includeContent ? (page?.content ?? "").slice(0, maxChars) : "",
      html: options.includeHtml ? html.slice(0, maxChars) : "",
      images: page?.images?.slice(0, 24) ?? [],
      links: page?.links?.slice(0, 40) ?? [],
      capturedAt: Date.now()
    };
  }

  private async readWebPageForApi(input: string | ({ url?: string } & MobileWebviewerContextOptions) = {}): Promise<MobileWebviewerContext> {
    const options = typeof input === "string" ? { url: input } : input;
    const url = options.url?.trim();
    if (!url) return await this.getCurrentWebContext({ ...options, includeContent: true });
    const normalized = normalizeInput(url, this.settings.searchUrl);
    if (!/^https?:\/\//i.test(normalized)) throw new Error("Mobile Webviewer readPage requires an http(s) URL");
    const previousCache = options.refresh ? [...this.settings.pageCache] : null;
    if (previousCache) this.settings.pageCache = this.settings.pageCache.filter((entry) => entry.url !== normalized);
    let page: NotePage;
    try {
      page = await this.fetchNotePage(normalized);
    } catch (error) {
      if (previousCache) this.settings.pageCache = previousCache;
      throw error;
    }
    const maxChars = clampNumber(Math.round(options.maxChars ?? 40000), 1000, 200000);
    return {
      apiVersion: MOBILE_WEBVIEWER_API_VERSION,
      pluginVersion: this.manifest.version,
      url: page.url,
      title: page.title,
      tabId: "",
      source: "settings",
      selectedText: "",
      byline: page.byline,
      excerpt: page.excerpt.slice(0, Math.min(maxChars, 1200)),
      content: page.content.slice(0, maxChars),
      html: "",
      images: page.images.slice(0, 24),
      links: page.links.slice(0, 40),
      capturedAt: Date.now()
    };
  }

  private async openFromApi(input: string | { url?: string; newTab?: boolean; mode?: "view" | "note" } = {}): Promise<Record<string, unknown>> {
    const options = typeof input === "string" ? { url: input } : input;
    const url = normalizeInput(options.url || this.settings.homeUrl, this.settings.searchUrl);
    if (options.mode === "note") {
      await this.openNoteBrowser(url, Boolean(options.newTab));
    } else {
      await this.activateBrowserView(url, Boolean(options.newTab));
    }
    this.emitApiEvent({ type: "navigate", url, title: hostName(url) });
    return { opened: true, url, mode: options.mode ?? "view", newTab: Boolean(options.newTab) };
  }

  private browserTabSummaryForApi(tab: BrowserTab): MobileWebviewerTabSummary {
    return {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      active: tab.id === this.settings.activeBrowserTabId,
      canGoBack: tab.back.length > 0,
      canGoForward: tab.forward.length > 0,
      updatedAt: tab.time
    };
  }

  private listBrowserTabsForApi(): MobileWebviewerTabSummary[] {
    return this.settings.browserTabs.map((tab) => this.browserTabSummaryForApi(tab));
  }

  private async newBrowserTabFromApi(input: string | { url?: string } = {}): Promise<MobileWebviewerTabSummary> {
    const url = normalizeInput(typeof input === "string" ? input : input.url || this.settings.homeUrl, this.settings.searchUrl);
    const target = this.resolveActiveWebContextTarget();
    if (target.view) {
      await target.view.newBrowserTab(url);
    } else if (target.embed) {
      await this.newEmbedBrowserTab(target.embed, url);
    } else {
      const tab = this.createBrowserTab(url);
      this.settings.browserTabs.unshift(tab);
      this.settings.activeBrowserTabId = tab.id;
      await this.saveSettings();
      await this.activateBrowserView(url, true, tab.id);
    }
    const tab = this.ensureBrowserTab(this.settings.activeBrowserTabId);
    this.emitApiEvent({ type: "tab-change", tabId: tab.id, url: tab.url, title: tab.title, detail: { operation: "new" } });
    return this.browserTabSummaryForApi(tab);
  }

  private async switchBrowserTabFromApi(input: string | { id: string }): Promise<MobileWebviewerTabSummary> {
    const id = typeof input === "string" ? input : input.id;
    const tab = this.settings.browserTabs.find((entry) => entry.id === id);
    if (!tab) throw new Error(`Mobile Webviewer tab not found: ${id}`);
    const target = this.resolveActiveWebContextTarget();
    if (target.view) await target.view.switchBrowserTab(id);
    else if (target.embed) await this.switchEmbedBrowserTab(target.embed, id);
    else {
      this.settings.activeBrowserTabId = id;
      await this.saveSettings();
      await this.activateBrowserView(tab.url, false, id);
    }
    this.emitApiEvent({ type: "tab-change", tabId: id, url: tab.url, title: tab.title, detail: { operation: "switch" } });
    return this.browserTabSummaryForApi(tab);
  }

  private async closeBrowserTabFromApi(input: string | { id: string }): Promise<{ closed: string; activeTabId: string }> {
    const id = typeof input === "string" ? input : input.id;
    if (!this.settings.browserTabs.some((entry) => entry.id === id)) throw new Error(`Mobile Webviewer tab not found: ${id}`);
    const target = this.resolveActiveWebContextTarget();
    if (target.view) await target.view.closeBrowserTab(id);
    else if (target.embed) await this.closeEmbedBrowserTab(target.embed, id);
    else {
      this.settings.browserTabs = this.settings.browserTabs.filter((entry) => entry.id !== id);
      const next = this.ensureBrowserTab(this.settings.activeBrowserTabId === id ? "" : this.settings.activeBrowserTabId);
      this.settings.activeBrowserTabId = next.id;
      await this.saveSettings();
    }
    const activeTabId = this.settings.activeBrowserTabId;
    this.emitApiEvent({ type: "tab-close", tabId: id, detail: { activeTabId } });
    return { closed: id, activeTabId };
  }

  private async toggleBookmarkFromApi(input: { url?: string; title?: string } = {}): Promise<{ bookmarked: boolean; url: string; title: string }> {
    const current = this.resolveActiveWebContextTarget();
    const url = normalizeInput(input.url || current.url, this.settings.searchUrl);
    const title = input.title?.trim() || current.title || hostName(url);
    const bookmarked = await this.toggleBookmarkEntry(url, title);
    this.emitApiEvent({ type: "bookmark-change", url, title, detail: { bookmarked } });
    return { bookmarked, url, title };
  }

  private async addToReadingListFromApi(input: { url?: string; title?: string } = {}): Promise<{ added: boolean; url: string; title: string }> {
    const current = this.resolveActiveWebContextTarget();
    const url = normalizeInput(input.url || current.url, this.settings.searchUrl);
    const title = input.title?.trim() || current.title || hostName(url);
    await this.addReadingList({ url, title, time: Date.now() });
    this.emitApiEvent({ type: "reading-list-change", url, title, detail: { added: true } });
    return { added: true, url, title };
  }

  private contextForCancip(context: MobileWebviewerContext): string {
    return [
      "Mobile Webviewer context",
      `Title: ${context.title}`,
      `URL: ${context.url}`,
      context.byline ? `Byline: ${context.byline}` : "",
      context.selectedText ? `Selected text:\n${context.selectedText}` : "",
      context.content ? `Reader content:\n${context.content}` : "",
      context.images.length ? `Images:\n${context.images.map((url) => `- ${url}`).join("\n")}` : "",
      context.links.length ? `Links:\n${context.links.map((link) => `- [${link.title}](${link.url})`).join("\n")}` : ""
    ].filter(Boolean).join("\n\n");
  }

  async sendCurrentToCancip(input: { prompt?: string; submit?: boolean; reveal?: boolean; focus?: boolean; maxChars?: number } = {}): Promise<Record<string, unknown>> {
    const context = await this.getCurrentWebContext({
      includeContent: true,
      includeSelection: true,
      maxChars: input.maxChars ?? 40000
    });
    const plugin = (this.app as AppWithRuntimePlugins).plugins?.plugins?.cancip;
    const cancip = plugin && typeof plugin === "object" ? plugin as CancipPluginLike : null;
    const receiver = cancip?.api?.receiveExternalContext ?? cancip?.receiveExternalContext;
    const payload: CancipExternalContextInput = {
      source: "mobile-webviewer",
      label: `Web: ${context.title}`,
      content: this.contextForCancip(context),
      url: context.url,
      title: context.title,
      prompt: input.prompt?.trim() || "",
      submit: Boolean(input.submit),
      reveal: input.reveal !== false,
      focus: input.focus !== false,
      metadata: {
        apiVersion: MOBILE_WEBVIEWER_API_VERSION,
        tabId: context.tabId,
        selected: Boolean(context.selectedText),
        images: context.images.length,
        links: context.links.length
      }
    };
    if (typeof receiver === "function") {
      const owner = cancip?.api?.receiveExternalContext === receiver ? cancip.api : cancip;
      const result = await Promise.resolve(receiver.call(owner, payload));
      await this.addConsole("info", "Sent structured web context to Cancip", context.url);
      return { sent: true, route: "api", context, result };
    }

    await navigator.clipboard.writeText(payload.content);
    await this.openCancip();
    await this.addConsole("warn", "Cancip context API unavailable; copied context to clipboard", context.url);
    return { sent: false, route: "clipboard", context };
  }

  private subscribeApi(listener: MobileWebviewerApiListener): () => void {
    if (typeof listener !== "function") throw new Error("Mobile Webviewer subscribe requires a listener function");
    this.apiListeners.add(listener);
    return () => this.apiListeners.delete(listener);
  }

  emitApiEvent(event: Omit<MobileWebviewerApiEvent, "time">): void {
    const payload: MobileWebviewerApiEvent = { ...event, time: Date.now() };
    for (const listener of this.apiListeners) {
      try {
        listener(payload);
      } catch (error) {
        console.warn("[mobile-webviewer] API listener failed", error);
      }
    }
  }

  getCancipStatus(): { enabled: boolean; version: string } {
    const plugin = (this.app as App & { plugins?: { plugins?: Record<string, { manifest?: { version?: string } }> } })
      .plugins?.plugins?.cancip;
    return {
      enabled: Boolean(plugin),
      version: plugin?.manifest?.version ?? ""
    };
  }

  async openCancip(): Promise<void> {
    const commands = (this.app as App & {
      commands?: {
        executeCommandById?: (id: string) => boolean;
        commands?: Record<string, { name?: string }>;
      };
    }).commands;
    const commandIds = Object.keys(commands?.commands ?? {});
    const id =
      commandIds.find((item) => item === "cancip:open-chat") ??
      commandIds.find((item) => item.startsWith("cancip:") && /open|chat/i.test(`${item} ${commands?.commands?.[item]?.name ?? ""}`));
    if (id && commands?.executeCommandById?.(id)) {
      await this.addConsole("info", `Opened Cancip via command: ${id}`);
      return;
    }
    const plugin = (this.app as AppWithRuntimePlugins)
      .plugins?.plugins?.cancip;
    const cancipPlugin = plugin && typeof plugin === "object" ? plugin as CancipPluginLike : null;
    if (typeof cancipPlugin?.activateView === "function") {
      await Promise.resolve(cancipPlugin.activateView());
      await this.addConsole("info", "Opened Cancip via plugin API");
      return;
    }
    new Notice(this.tr("cancipDisabled"));
    await this.addConsole("warn", "Cancip plugin is not enabled");
  }

  async applyWebviewRuntime(webview: ElectronWebviewElement): Promise<void> {
    // Keep a real webpage exactly as delivered by its site. Delayed CSS,
    // ad-observer mutations, and page zoom changes otherwise alter the page
    // after first paint and make its layout appear to jump or collapse.
    if (this.isRawRealWebview(webview)) return;
    if (!this.isBrowserSurfaceReady(webview)) return;
    const zoom = clampNumber(this.settings.pageZoom || 100, 50, 200) / 100;
    try {
      webview.setZoomFactor?.(zoom);
    } catch {
      await this.addConsole("warn", "Webview zoom unavailable", this.safeWebviewUrl(webview));
    }

    const cssParts: string[] = [];
    if (this.settings.noImageMode) {
      cssParts.push("img,picture,source[srcset],video[poster]{display:none;}");
    }
    if (this.settings.adBlockEnabled) {
      cssParts.push(`${AD_CANDIDATE_SELECTOR}{display:none;}`);
    } else if (this.settings.markAdsEnabled) {
      cssParts.push(`${AD_CANDIDATE_SELECTOR}{outline:2px dashed #ef4444;outline-offset:2px;}`);
    }
    if (this.settings.eyeProtectionMode) {
      cssParts.push("html{background:#f3f8ea;} body{background:#f3f8ea;}");
    }
    if (this.settings.nightMode) {
      cssParts.push("html{filter:brightness(.82) contrast(1.08);background:#101112;}");
    }
    if (!cssParts.length || !webview.executeJavaScript) return;

    const css = cssParts.join("\n");
    const code = `
      (() => {
        const doc = document;
        const id = "mwv-runtime-style";
        doc.getElementById(id)?.remove();
        const style = doc.createElement("style");
        style.id = id;
        style.textContent = ${JSON.stringify(css)};
        doc.documentElement.appendChild(style);
        const selector = ${JSON.stringify(AD_CANDIDATE_SELECTOR)};
        const hideAds = ${JSON.stringify(this.settings.adBlockEnabled)};
        const markAds = ${JSON.stringify(this.settings.markAdsEnabled)};
        const applyAdMode = () => {
          if (!hideAds && !markAds) return;
          doc.querySelectorAll(selector).forEach((node) => {
            if (!node || node.nodeType !== 1) return;
            if (hideAds) {
              node.classList.add("mwv-ad-hidden");
              node.setAttribute("data-mwv-ad-hidden", "true");
            } else if (markAds) {
              node.classList.add("mwv-ad-candidate");
            }
          });
        };
        window.__mwvAdObserver?.disconnect?.();
        applyAdMode();
        if (hideAds || markAds) {
          window.__mwvAdObserver = new MutationObserver(() => applyAdMode());
          window.__mwvAdObserver.observe(doc.documentElement || doc.body, { childList: true, subtree: true });
        }
      })();
    `;
    try {
      await webview.executeJavaScript(code, false);
    } catch {
      await this.addConsole("warn", "Webview runtime filters limited", this.safeWebviewUrl(webview));
    }
  }

  getUserAgentHeader(url = ""): string {
    if (url && this.isBingHome(url)) {
      const chromeVersion = (window as BrowserWindowWithProcess).process?.versions?.chrome ?? "";
      const chromeMajor = chromeVersion.match(/^\d+/)?.[0] ?? "125";
      return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`;
    }
    if (this.settings.userAgentMode === "desktop" || this.settings.desktopMode) {
      return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
    }
    return "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36";
  }

  applyBrowserSurfaceUserAgent(webview: ElectronWebviewElement, url: string): void {
    const userAgent = this.getUserAgentHeader(url);
    webview.setAttribute("useragent", userAgent);
    if (!this.isBrowserSurfaceReady(webview)) return;
    try {
      webview.setUserAgent?.(userAgent);
    } catch {
      // A surface can be destroyed while a navigation is being prepared.
    }
  }

  requestHeaders(accept: string): Record<string, string> {
    return {
      "Accept": accept,
      "Accept-Language": acceptLanguageHeader(this.settings.uiLanguage || DEFAULT_UI_LANGUAGE),
      "Cache-Control": "no-cache",
      "Upgrade-Insecure-Requests": "1",
      "User-Agent": this.getUserAgentHeader()
    };
  }

  private static cookieKey(domain: string, path: string, name: string): string {
    return `${domain.toLowerCase()}|${path || "/"}|${name}`;
  }

  private pruneExpiredCookies(): void {
    const now = Date.now();
    for (const [key, cookie] of Object.entries(this.settings.cookieJar)) {
      if (cookie.expires > 0 && cookie.expires < now) delete this.settings.cookieJar[key];
    }
  }

  /** Parses Set-Cookie header values (one per entry; multi headers may be newline-joined). */
  captureSetCookies(pageUrl: string, headers: Record<string, string> | undefined): number {
    if (!headers || this.settings.incognitoMode) return 0;
    const raw = headerValue(headers, "set-cookie");
    if (!raw) return 0;
    let stored = 0;
    for (const line of raw.split(/\r?\n/)) {
      if (this.storeCookieFromSetCookie(pageUrl, line.trim())) stored++;
    }
    if (stored) void this.saveSettings();
    return stored;
  }

  storeCookieFromSetCookie(pageUrl: string, raw: string): boolean {
    if (!raw) return false;
    let host = "";
    try {
      host = new URL(pageUrl).hostname.toLowerCase();
    } catch {
      return false;
    }
    const parts = raw.split(";");
    const first = parts[0] ?? "";
    const eq = first.indexOf("=");
    if (eq <= 0) return false;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name) return false;
    let domain = host;
    let path = "/";
    let expires = 0;
    let secure = false;
    let hostOnly = true;
    for (let i = 1; i < parts.length; i++) {
      const attr = parts[i].trim();
      const aeq = attr.indexOf("=");
      const akey = (aeq >= 0 ? attr.slice(0, aeq) : attr).trim().toLowerCase();
      const avalue = aeq >= 0 ? attr.slice(aeq + 1).trim() : "";
      if (akey === "domain" && avalue) {
        domain = avalue.replace(/^\./, "").toLowerCase();
        hostOnly = false;
      } else if (akey === "path" && avalue) {
        path = avalue.startsWith("/") ? avalue : `/${avalue}`;
      } else if (akey === "expires" && avalue) {
        const parsed = Date.parse(avalue);
        if (!Number.isNaN(parsed)) expires = parsed;
      } else if (akey === "max-age" && avalue) {
        const seconds = Number(avalue);
        if (Number.isFinite(seconds)) expires = seconds <= 0 ? 1 : Date.now() + seconds * 1000;
      } else if (akey === "secure") {
        secure = true;
      }
    }
    if (expires > 0 && expires < Date.now()) {
      delete this.settings.cookieJar[MobileWebviewerPlugin.cookieKey(domain, path, name)];
      return true;
    }
    this.settings.cookieJar[MobileWebviewerPlugin.cookieKey(domain, path, name)] = { name, value, domain, path, expires, secure, hostOnly };
    return true;
  }

  /** Stores a document.cookie write coming from a proxied page (relative to that page's URL). */
  storeCookieFromDocument(pageUrl: string, raw: string): void {
    if (this.settings.incognitoMode || !raw) return;
    const eq = raw.indexOf("=");
    if (eq <= 0) return;
    const name = raw.slice(0, eq).trim();
    const rest = raw.slice(eq + 1);
    const attrs = rest.split(";");
    const value = (attrs[0] ?? "").trim();
    let domain = "";
    let path = "/";
    let expires = 0;
    for (let i = 1; i < attrs.length; i++) {
      const attr = attrs[i].trim();
      const aeq = attr.indexOf("=");
      const akey = (aeq >= 0 ? attr.slice(0, aeq) : attr).trim().toLowerCase();
      const avalue = aeq >= 0 ? attr.slice(aeq + 1).trim() : "";
      if (akey === "domain" && avalue) domain = avalue.replace(/^\./, "").toLowerCase();
      else if (akey === "path" && avalue) path = avalue.startsWith("/") ? avalue : `/${avalue}`;
      else if (akey === "expires" && avalue) {
        const parsed = Date.parse(avalue);
        if (!Number.isNaN(parsed)) expires = parsed;
      } else if (akey === "max-age" && avalue) {
        const seconds = Number(avalue);
        if (Number.isFinite(seconds)) expires = seconds <= 0 ? 1 : Date.now() + seconds * 1000;
      }
    }
    try {
      const host = domain || new URL(pageUrl).hostname.toLowerCase();
      const key = MobileWebviewerPlugin.cookieKey(host, path, name);
      if (value === "" || (expires > 0 && expires < Date.now())) delete this.settings.cookieJar[key];
      else this.settings.cookieJar[key] = { name, value, domain: host, path, expires, secure: /^https:/i.test(pageUrl), hostOnly: !domain };
      void this.saveSettings();
    } catch {
      // Ignore cookies for unparsable page URLs.
    }
  }

  /** RFC-6265-style domain/path/secure matching for the outgoing Cookie header. */
  cookieHeaderForUrl(url: string): string {
    if (this.settings.incognitoMode) return "";
    this.pruneExpiredCookies();
    let host = "";
    let urlPath = "/";
    let isHttps = false;
    try {
      const parsed = new URL(url);
      host = parsed.hostname.toLowerCase();
      urlPath = parsed.pathname || "/";
      isHttps = parsed.protocol === "https:";
    } catch {
      return "";
    }
    const pairs: string[] = [];
    for (const cookie of Object.values(this.settings.cookieJar)) {
      if (cookie.hostOnly ? cookie.domain !== host : !(host === cookie.domain || host.endsWith(`.${cookie.domain}`))) continue;
      if (cookie.path !== "/") {
        if (!urlPath.startsWith(cookie.path)) continue;
        if (cookie.path.endsWith("/") === false && urlPath.charAt(cookie.path.length) && urlPath.charAt(cookie.path.length) !== "/") continue;
      }
      if (cookie.secure && !isHttps) continue;
      pairs.push(`${cookie.name}=${cookie.value}`);
    }
    return pairs.join("; ");
  }

  async clearProxyCookies(): Promise<void> {
    this.settings.cookieJar = {};
    await this.saveSettings();
  }

  private storageOriginOf(url: string): string {
    try {
      return new URL(url).origin;
    } catch {
      return "";
    }
  }

  storageMapForUrl(url: string): Record<string, string> {
    return this.settings.proxyStorage[this.storageOriginOf(url)] ?? {};
  }

  handleProxyStorageSet(url: string, kind: string, key: string, value: string | null): void {
    if (this.settings.incognitoMode) return;
    const origin = this.storageOriginOf(url);
    if (!origin || !key) return;
    if (kind !== "local") return;
    const map = this.settings.proxyStorage[origin] ?? (this.settings.proxyStorage[origin] = {});
    if (key === "__mwv_clear__") {
      this.settings.proxyStorage[origin] = {};
    } else if (value === null) {
      delete map[key];
    } else {
      map[key] = value;
    }
    void this.saveSettings();
  }

  private proxySeedScript(url: string): string {
    if (this.settings.incognitoMode) return "window.__mwvInit = {};";
    const cookies: Record<string, string> = {};
    this.pruneExpiredCookies();
    const host = this.storageOriginOf(url);
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      for (const cookie of Object.values(this.settings.cookieJar)) {
        if (cookie.hostOnly ? cookie.domain !== hostname : hostname === cookie.domain || hostname.endsWith(`.${cookie.domain}`)) {
          cookies[cookie.name] = cookie.value;
        }
      }
    } catch {
      // No seed cookies for unparsable URLs.
    }
    void host;
    return `window.__mwvInit = ${JSON.stringify({ cookies, storage: this.storageMapForUrl(url) })};`;
  }

  applyBrowserRuntimeClasses(root: HTMLElement): void {
    const rawSurface = root.matches(
      ".mwv-root.is-raw-web, .mwv-root[data-notedraw-ignore], .mwv-embed.is-web-front, .mwv-note-embed.is-web-front, .mwv-bing-home.is-web-front"
    );
    if (rawSurface) {
      // A raw page is rendered by the site itself. Remove every host-side
      // presentation class before/after the live WebView is attached so a
      // delayed settings/layout pass cannot apply night mode, rotation,
      // image hiding, RTL, or reader scaling to the original page surface.
      root.removeClass("mwv-night-mode");
      root.removeClass("mwv-no-images");
      root.removeClass("mwv-eye-protection");
      root.removeClass("mwv-adblock-on");
      root.removeClass("mwv-mark-ads");
      root.removeClass("mwv-incognito");
      root.removeClass("mwv-fullscreen");
      root.removeClass("mwv-rotated");
      root.removeAttribute("dir");
      root.removeAttribute("lang");
      root.style.removeProperty("--mwv-reader-font-scale");
      root.style.removeProperty("--mwv-page-zoom");
      return;
    }
    root.toggleClass("mwv-night-mode", this.settings.nightMode);
    root.toggleClass("mwv-no-images", this.settings.noImageMode);
    root.toggleClass("mwv-eye-protection", this.settings.eyeProtectionMode);
    root.toggleClass("mwv-adblock-on", this.settings.adBlockEnabled);
    root.toggleClass("mwv-mark-ads", this.settings.markAdsEnabled);
    root.toggleClass("mwv-incognito", this.settings.incognitoMode);
    root.toggleClass("mwv-fullscreen", this.settings.fullScreenMode);
    root.toggleClass("mwv-rotated", this.settings.rotatedMode);
    const language = this.resolvedUiLanguage();
    root.dataset.mwvUiLanguage = language;
    root.setAttribute("lang", language);
    root.setAttribute("dir", isRtlUiLanguage(language) ? "rtl" : "ltr");
    root.toggleClass("mwv-rtl", isRtlUiLanguage(language));
    root.setCssProps({ "--mwv-reader-font-scale": String(clampNumber(this.settings.readerFontScale, 80, 160) / 100) });
  }

  applyRuntimePreferencesIn(root: HTMLElement): void {
    this.applyBrowserRuntimeClasses(root);
    this.applyFramePreferencesIn(root);
    root.querySelectorAll<BrowserSurfaceElement>(".mwv-frame, .mwv-live-frame").forEach((frame) => {
      if (this.isElectronWebview(frame)) {
        frame.setAttribute("webpreferences", this.buildWebviewPreferences());
        this.applyBrowserSurfaceUserAgent(frame, this.safeWebviewUrl(frame));
        void this.applyWebviewRuntime(frame);
      } else {
        frame.setAttribute("sandbox", this.buildFrameSandbox(frame.hasClass("mwv-live-frame")));
      }
    });
  }

  async applyAccessibleFrameFilters(frame: BrowserSurfaceElement, url: string): Promise<void> {
    if (this.isRawRealBrowserSurface(frame)) return;
    if (this.isElectronWebview(frame)) {
      await this.applyWebviewRuntime(frame);
      return;
    }
    try {
      const doc = frame.contentDocument;
      if (!doc) return;
      this.cleanDocumentForModes(doc);
      await this.addConsole("info", "Applied accessible page filters", url);
    } catch {
      await this.addConsole("warn", "Live page filters limited by page isolation", url);
    }
  }

  cleanDocumentForModes(doc: Document): void {
    if (this.settings.noImageMode) {
      doc.querySelectorAll("img, picture, source[srcset], video[poster]").forEach((node) => node.remove());
    }
    const applyAdMode = () => {
      if (this.settings.adBlockEnabled) {
        doc.querySelectorAll(AD_CANDIDATE_SELECTOR).forEach((node) => node.remove());
      } else if (this.settings.markAdsEnabled) {
        doc.querySelectorAll<HTMLElement>(AD_CANDIDATE_SELECTOR).forEach((node) => node.addClass("mwv-ad-candidate"));
      }
    };
    applyAdMode();
    const win = doc.defaultView as (Window & { __mwvAdObserver?: MutationObserver }) | null;
    if (win && (this.settings.adBlockEnabled || this.settings.markAdsEnabled)) {
      win.__mwvAdObserver?.disconnect();
      win.__mwvAdObserver = new MutationObserver(() => applyAdMode());
      win.__mwvAdObserver.observe(doc.documentElement || doc.body, { childList: true, subtree: true });
    }
  }

  renderUrlSuggestions(parent: HTMLElement, id: string): void {
    const datalist = parent.createEl("datalist", { attr: { id } });
    const entries = uniqueEntries(
      [
        ...this.settings.bookmarks,
        ...this.settings.readingList,
        ...this.settings.history
      ],
      40
    );
    for (const entry of entries) {
      datalist.createEl("option", {
        attr: {
          value: entry.url,
          label: entry.title || hostName(entry.url)
        }
      });
    }
  }

  applyFrameViewPreferences(frame: BrowserSurfaceElement): void {
    const rawWebview = this.isRawRealBrowserSurface(frame);
    const zoom = rawWebview ? 100 : clampNumber(this.settings.pageZoom || 100, 50, 200);
    frame.setCssProps({ "--mwv-page-zoom": String(zoom / 100) });
    if (this.isElectronWebview(frame)) {
      frame.setCssStyles({ zoom: "1" });
      if (!this.isBrowserSurfaceReady(frame)) return;
      try {
        frame.setZoomFactor?.(rawWebview ? 1 : zoom / 100);
      } catch {
        // The webview may not be ready yet; dom-ready reapplies zoom.
      }
    } else {
      frame.setCssStyles({ zoom: rawWebview ? "1" : `${zoom}%` });
    }
    frame.toggleClass("mwv-desktop-frame", !rawWebview && this.settings.desktopMode);
  }

  applyFramePreferencesIn(root: HTMLElement): void {
    root.querySelectorAll<BrowserSurfaceElement>(".mwv-frame, .mwv-live-frame").forEach((frame) => {
      this.applyFrameViewPreferences(frame);
    });
  }

  async setPageZoom(value: number, root?: HTMLElement): Promise<void> {
    this.settings.pageZoom = clampNumber(Math.round(value), 50, 200);
    await this.saveSettings();
    if (root) this.applyFramePreferencesIn(root);
    await this.addConsole("info", `Zoom set to ${this.settings.pageZoom}%`);
  }

  async toggleDesktopMode(root?: HTMLElement): Promise<void> {
    this.settings.desktopMode = !this.settings.desktopMode;
    this.settings.userAgentMode = this.settings.desktopMode ? "desktop" : "mobile";
    await this.saveSettings();
    if (root) this.applyRuntimePreferencesIn(root);
    await this.addConsole("info", this.settings.desktopMode ? "Desktop mode enabled" : "Mobile mode enabled");
  }

  async toggleBooleanMode(key: keyof Pick<MobileWebviewerSettings,
    "nightMode" | "noImageMode" | "eyeProtectionMode" | "adBlockEnabled" | "markAdsEnabled" |
    "incognitoMode" | "jsDisabled" | "rotatedMode">, root?: HTMLElement, label?: string): Promise<void> {
    (this.settings as unknown as Record<string, boolean>)[key] = !this.settings[key];
    await this.saveSettings();
    if (root) this.applyRuntimePreferencesIn(root);
    await this.addConsole("info", `${label ?? String(key)} ${this.settings[key] ? "enabled" : "disabled"}`);
  }

  async setAdMode(block: boolean, mark: boolean, root?: HTMLElement): Promise<void> {
    this.settings.adBlockEnabled = block;
    this.settings.markAdsEnabled = block ? false : mark;
    await this.saveSettings();
    if (root) this.applyRuntimePreferencesIn(root);
    await this.addConsole("info", this.settings.adBlockEnabled ? "Ad block enabled" : this.settings.markAdsEnabled ? "Ad marking enabled" : "Ad filtering disabled");
  }

  async toggleFullscreen(root?: HTMLElement): Promise<void> {
    this.settings.fullScreenMode = !this.settings.fullScreenMode;
    await this.saveSettings();
    if (root) {
      this.applyRuntimePreferencesIn(root);
      try {
        const doc = appDocument();
        if (this.settings.fullScreenMode && !doc.fullscreenElement) {
          await root.requestFullscreen?.();
        } else if (!this.settings.fullScreenMode && doc.fullscreenElement) {
          await doc.exitFullscreen?.();
        }
      } catch {
        await this.addConsole("warn", "Fullscreen API limited by host");
      }
    }
    await this.addConsole("info", this.settings.fullScreenMode ? "Fullscreen enabled" : "Fullscreen disabled");
  }

  async adjustReaderFont(delta: number, root?: HTMLElement): Promise<void> {
    this.settings.readerFontScale = clampNumber((this.settings.readerFontScale || 100) + delta, 80, 160);
    await this.saveSettings();
    if (root) this.applyRuntimePreferencesIn(root);
    await this.addConsole("info", `Font size ${this.settings.readerFontScale}%`);
  }

  async toggleUserAgent(root?: HTMLElement): Promise<void> {
    this.settings.userAgentMode = this.settings.userAgentMode === "desktop" ? "mobile" : "desktop";
    this.settings.desktopMode = this.settings.userAgentMode === "desktop";
    await this.saveSettings();
    if (root) this.applyRuntimePreferencesIn(root);
    await this.addConsole("info", `UA switched to ${this.settings.userAgentMode}`);
  }

  async clearBrowsingData(): Promise<void> {
    this.settings.history = [];
    this.settings.pageCache = [];
    this.settings.consoleEntries = [];
    await this.saveSettings();
  }

  async findInTargets(query: string, root: HTMLElement, frame?: BrowserSurfaceElement, direction = 1): Promise<number> {
    this.clearFindMarks(root);
    const clean = query.trim();
    if (!clean) return 0;

    let frameHit = 0;
    if (frame) {
      if (this.isElectronWebview(frame)) {
        if (!this.isBrowserSurfaceReady(frame)) return 0;
        try {
          frame.stopFindInPage?.("clearSelection");
          const requestId = frame.findInPage?.(clean, {
            forward: direction >= 0,
            findNext: false,
            matchCase: false
          });
          frameHit = requestId ? 1 : 0;
        } catch {
          await this.addConsole("warn", "Find skipped webview surface");
        }
      } else if (frame.dataset.mwvProxyUrl) {
        // Proxied pages sandbox away window.find; the in-page bridge handles it.
        frameHit = await this.proxyFindInFrame(frame, clean, direction);
      } else {
        try {
          const win: WindowWithFind | null = frame.contentWindow;
          if (win?.find?.(clean, false, direction < 0, true, false, true, false)) {
            frameHit = 1;
          }
        } catch {
          await this.addConsole("warn", "Find skipped live frame by page isolation");
        }
      }
    }

    let count = 0;
    const searchRoots = Array.from(root.querySelectorAll<HTMLElement>(
      ".mwv-home, .mwv-reader-panel, .mwv-bing-results, .mwv-note-surface, .mwv-extension-panel"
    ));
    for (const target of searchRoots) {
      count += this.markTextMatches(target, clean);
    }

    const first = root.querySelector<HTMLElement>(".mwv-find-mark");
    first?.scrollIntoView({ block: "center", behavior: "smooth" });
    await this.addConsole("info", `Find '${clean}' matched ${count + frameHit}`);
    return count + frameHit;
  }

  clearFindMarks(root: HTMLElement): void {
    const marks = Array.from(root.querySelectorAll<HTMLElement>("mark.mwv-find-mark"));
    for (const mark of marks) {
      const parent = mark.parentNode;
      parent?.replaceChild(root.ownerDocument.createTextNode(mark.textContent ?? ""), mark);
      parent?.normalize();
    }
    root.querySelectorAll<HTMLIFrameElement>("iframe[data-mwv-proxy-url]").forEach((frame) => {
      this.proxyClearFind(frame);
    });
  }

  markTextMatches(root: HTMLElement, query: string): number {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "gi");
    const ownerDoc = root.ownerDocument;
    const walker = ownerDoc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest(".mwv-find-panel, input, textarea, button, script, style, mark.mwv-find-mark")) {
          return NodeFilter.FILTER_REJECT;
        }
        pattern.lastIndex = 0;
        return pattern.test(node.nodeValue ?? "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    const nodes: Text[] = [];
    while (walker.nextNode()) {
      nodes.push(walker.currentNode as Text);
    }

    let count = 0;
    for (const node of nodes) {
      const text = node.nodeValue ?? "";
      pattern.lastIndex = 0;
      let lastIndex = 0;
      const fragment = ownerDoc.createDocumentFragment();
      for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        const index = match.index;
        if (index > lastIndex) fragment.appendChild(ownerDoc.createTextNode(text.slice(lastIndex, index)));
        const mark = ownerDoc.createElement("mark");
        mark.addClass("mwv-find-mark");
        mark.textContent = match[0];
        fragment.appendChild(mark);
        lastIndex = index + match[0].length;
        count++;
      }
      if (lastIndex < text.length) fragment.appendChild(ownerDoc.createTextNode(text.slice(lastIndex)));
      node.parentNode?.replaceChild(fragment, node);
    }
    return count;
  }

  applyReaderCustomizations(container: HTMLElement, page: NotePage): void {
    if (!this.settings.userScriptsEnabled) return;
    const styleEnabled = Boolean(this.settings.readerUserStyle.trim());
    const scriptEnabled = Boolean(this.settings.readerUserScript.trim());
    const rules = this.getActiveUserScriptRules(page.url);
    const hasCustomRule = rules.some((rule) => !rule.id.startsWith("builtin-") && (rule.css.trim() || rule.js.trim()));
    if (styleEnabled || scriptEnabled || hasCustomRule) {
      container.addClass("mwv-reader-customizations-disabled");
      void this.addConsole("warn", "Reader custom CSS/JavaScript is disabled in the community-safe build", page.url);
    }
  }

  async autofillFrame(frame: BrowserSurfaceElement, url: string): Promise<number> {
    if (this.isElectronWebview(frame)) {
      const profile: AutofillProfile = {
        name: this.settings.autofillName.trim(),
        email: this.settings.autofillEmail.trim(),
        phone: this.settings.autofillPhone.trim(),
        address: this.settings.autofillAddress.trim()
      };
      if (!hasAutofillProfileValue(profile)) return 0;
      if (!frame.executeJavaScript) {
        await this.addConsole("warn", "Autofill unavailable in webview", url);
        return 0;
      }
      const code = `
        (() => {
          const doc = document;
          const profile = ${JSON.stringify(profile)};
          const values = Object.values(profile).filter(Boolean);
          if (!values.length) return 0;
          const fill = (el, value) => {
            if (!el || el.disabled || el.readOnly || el.value) return false;
            el.focus();
            el.value = value;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          };
          let count = 0;
          for (const el of Array.from(doc.querySelectorAll("input, textarea"))) {
            const hint = [
              el.name,
              el.id,
              el.autocomplete,
              el.placeholder,
              el.getAttribute("aria-label")
            ].filter(Boolean).join(" ").toLowerCase();
            let value = "";
            if (/mail|email|邮箱|邮件/.test(hint)) value = profile.email;
            else if (/phone|tel|mobile|手机号|电话/.test(hint)) value = profile.phone;
            else if (/addr|address|地址/.test(hint)) value = profile.address;
            else if (/name|user|姓名|名字/.test(hint)) value = profile.name;
            if (value && fill(el, value)) count++;
          }
          return count;
        })();
      `;
      try {
        const result = await frame.executeJavaScript(code, true);
        const count = typeof result === "number" ? result : 0;
        await this.addConsole("info", `Autofill touched ${count} field(s)`, url);
        return count;
      } catch {
        await this.addConsole("warn", "Autofill skipped by webview isolation", url);
        return 0;
      }
    }

    try {
      const doc = frame.contentDocument;
      if (!doc) {
        await this.addConsole("warn", "Autofill document unavailable", url);
        return 0;
      }
      const count = this.autofillDocument(doc);
      await this.addConsole("info", `Autofill touched ${count} field(s)`, url);
      return count;
    } catch {
      await this.addConsole("warn", "Autofill skipped by page isolation", url);
      return 0;
    }
  }

  autofillDocument(doc: Document): number {
    const profile: AutofillProfile = {
      name: this.settings.autofillName.trim(),
      email: this.settings.autofillEmail.trim(),
      phone: this.settings.autofillPhone.trim(),
      address: this.settings.autofillAddress.trim()
    };
    if (!hasAutofillProfileValue(profile)) return 0;

    let count = 0;
    const fields = Array.from(doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"));
    for (const field of fields) {
      if (field.disabled || field.readOnly || field.type === "password" || field.type === "hidden") continue;
      const haystack = [
        field.type,
        field.name,
        field.id,
        field.placeholder,
        field.getAttribute("autocomplete") ?? "",
        field.getAttribute("aria-label") ?? ""
      ].join(" ").toLowerCase();
      const value =
        /email|e-mail|mail|邮箱/.test(haystack) ? profile.email :
        /tel|phone|mobile|cell|电话|手机/.test(haystack) ? profile.phone :
        /address|addr|street|city|地址|住址/.test(haystack) ? profile.address :
        /name|full-name|fullname|username|姓名|名字/.test(haystack) ? profile.name :
        "";
      if (!value || field.value) continue;
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      count++;
    }
    return count;
  }

  async openFirstLinkInFile(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const match = content.match(/https?:\/\/[^\s)\]]+/);
    if (!match) {
      new Notice(this.tr("noWebLinkFound"));
      return;
    }
    await this.activateBrowserView(match[0]);
  }

  async searchBing(query: string, pages = BING_DEFAULT_PAGES, maxResults = BING_DEFAULT_MAX_RESULTS): Promise<SearchResult[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];

    const url = DEFAULT_SEARCH.replace("{{query}}", encodeURIComponent(cleanQuery));
    const rssUrl = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(cleanQuery)}`;
    const parser = new DOMParser();
    void this.addConsole("info", `Search Bing: ${cleanQuery}`, url);

    try {
      const results: SearchResult[] = [];
      const seen = new Set<string>();
      const pageCount = clampNumber(Math.ceil(pages), 1, 8);
      const limit = clampNumber(Math.ceil(maxResults), 1, 80);

      for (let pageIndex = 0; pageIndex < pageCount && results.length < limit; pageIndex++) {
        const pageUrl = new URL(url);
        if (pageIndex > 0) {
          pageUrl.searchParams.set("first", String(pageIndex * BING_RESULTS_PER_PAGE + 1));
        }
        const pageUrlText = pageUrl.toString();
        const response = await requestUrl({
          url: pageUrlText,
          method: "GET",
          headers: this.requestHeaders("text/html,application/xhtml+xml")
        });

        const doc = parser.parseFromString(response.text, "text/html");
        const items = Array.from(doc.querySelectorAll("li.b_algo, .b_algo")).slice(0, BING_RESULTS_PER_PAGE + 4);

        for (const item of items) {
          const anchor = item.querySelector<HTMLAnchorElement>("h2 a, a");
          if (!anchor?.href) continue;
          const resultUrl = cleanResultUrl(anchor.href);
          if (!/^https?:\/\//i.test(resultUrl) || seen.has(resultUrl)) continue;
          const snippet = item.querySelector(".b_caption p, p")?.textContent?.trim() || "";
          const title = cleanSearchTitle(anchor.textContent?.trim() || "", resultUrl, snippet, cleanQuery);
          seen.add(resultUrl);
          results.push({
            title,
            url: resultUrl,
            snippet,
            imageUrl: firstImageFromElement(item, pageUrlText)
          });
          if (results.length >= limit) break;
        }
      }

      if (results.length) return results;
    } catch (error) {
      console.warn("[mobile-webviewer] Bing HTML search failed; trying RSS fallback", error);
      void this.addConsole("warn", "Bing HTML parser used RSS path", url);
    }

    try {
      const response = await requestUrl({
        url: rssUrl,
        method: "GET",
        headers: this.requestHeaders("application/rss+xml,application/xml,text/xml")
      });

      const doc = parser.parseFromString(response.text, "application/xml");
      const items = Array.from(doc.querySelectorAll("item")).slice(0, clampNumber(maxResults, 1, 80));
      const results: SearchResult[] = [];
      const seen = new Set<string>();

      for (const item of items) {
        const link = cleanResultUrl(textFromElement(item.querySelector("link")));
        const snippet = htmlToText(textFromElement(item.querySelector("description")));
        const title = cleanSearchTitle(textFromElement(item.querySelector("title")), link, snippet, cleanQuery);
        if (!title || !/^https?:\/\//i.test(link) || seen.has(link)) continue;
        seen.add(link);
        results.push({
          title,
          url: link,
          snippet
        });
      }

      if (results.length) return results;
    } catch (error) {
      console.warn("[mobile-webviewer] Bing RSS search failed; using compact result", error);
      void this.addConsole("warn", "Bing RSS parser used compact result", url);
    }

    return fallbackSearchResults(cleanQuery);
  }

  async fetchNotePage(url: string): Promise<NotePage> {
    const cached = this.getCachedPage(url);
    if (cached) {
      void this.addConsole("info", "Cache hit", url);
      return cached;
    }

    void this.addConsole("info", "Fetch reader layer", url);
    const response = await requestUrl({
      url,
      method: "GET",
      headers: this.requestHeaders("text/html,application/xhtml+xml")
    });

    const parser = new DOMParser();
    const doc = parser.parseFromString(response.text, "text/html");
    this.cleanDocumentForModes(doc);
    const images = imageCandidatesFromDocument(doc, url, 8);

    doc.querySelectorAll("script, style, noscript, svg, canvas, iframe, nav, footer, form, aside").forEach((node) => node.remove());

    const title =
      textFromElement(doc.querySelector("meta[property='og:title']")) ||
      textFromElement(doc.querySelector("title")) ||
      hostName(url);
    const byline =
      textFromElement(doc.querySelector("meta[name='author']")) ||
      textFromElement(doc.querySelector("[rel='author'], .author, .byline")) ||
      hostName(url);

    // Reader-mode root: instead of trusting the first matching container (which
    // on sites like MDN can be a small sidebar card), convert every plausible
    // container and keep whichever yields the richest Markdown.
    const candidates: Element[] = [];
    const seenRoots = new Set<Element>();
    const addCandidate = (element: Element | null) => {
      if (!element || seenRoots.has(element)) return;
      seenRoots.add(element);
      candidates.push(element);
    };
    addCandidate(doc.querySelector("article"));
    addCandidate(doc.querySelector("main"));
    addCandidate(doc.querySelector("[role='main']"));
    addCandidate(doc.querySelector(".markdown-body, .article-content, .post-content, .entry-content"));
    if (!candidates.length && doc.body) addCandidate(doc.body);

    let content = "";
    let bestRoot: Element | null = null;
    for (const candidate of candidates) {
      const markdown = htmlDocumentToMarkdown(candidate, url);
      if (markdown.length > content.length) {
        content = markdown;
        bestRoot = candidate;
      }
    }

    if ((!content || content.length < 160) && doc.body && bestRoot !== doc.body) {
      // App shells, galleries and paywalled roots produce almost nothing from
      // the narrow roots, so fall back to the whole document before giving up.
      const bodyMarkdown = htmlDocumentToMarkdown(doc.body, url);
      if (bodyMarkdown.length > content.length) {
        content = bodyMarkdown;
        bestRoot = doc.body;
      }
    }

    const linkRoot = bestRoot ?? doc.body;
    if (!content.trim()) throw new Error("No readable document body");

    const plainText = content.replace(/[#>*`~|]/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();

    const links: SearchResult[] = [];
    const seen = new Set<string>();
    for (const anchor of Array.from(linkRoot?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [])) {
      const href = absoluteUrl(anchor.getAttribute("href") ?? "", url);
      if (!/^https?:\/\//i.test(href) || seen.has(href)) continue;
      const label = textFromElement(anchor);
      if (label.length < 3) continue;
      seen.add(href);
      links.push({ title: label.slice(0, 120), url: href, snippet: hostName(href) });
      if (links.length >= 12) break;
    }

    const page = {
      title,
      url,
      byline,
      excerpt: (plainText || content).slice(0, 420),
      images,
      content,
      links
    };
    await this.rememberPageCache(page);
    return page;
  }

  async fetchFallbackNotePage(url: string, reason = ""): Promise<NotePage> {
    try {
      return await this.fetchNotePage(url);
    } catch (error) {
      const cached = this.getCachedPage(url);
      if (cached) return cached;
      const title = hostName(url) || "Web page";
      const message = reason || (error instanceof Error ? error.message : typeof error === "string" ? error : "Page load failed");
      return {
        title,
        url,
        byline: title,
        excerpt: message,
        images: [],
        content: [
          `# ${title}`,
          "",
          message,
          "",
          url
        ].join("\n"),
        links: []
      };
    }
  }

  openSettings(): void {
    const setting = (this.app as AppWithSettings).setting;
    setting?.open?.();
    setting?.openTabById?.(this.manifest.id);
  }

  async loadSettings(): Promise<void> {
    const rawSettings: unknown = await this.loadData();
    const loadedSettings = rawSettings && typeof rawSettings === "object"
      ? rawSettings as Partial<MobileWebviewerSettings>
      : {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedSettings);
    let shouldSaveSettings = false;
    this.settings.noteDrawLegacyWebviewerMigrationVersion = Number.isFinite(this.settings.noteDrawLegacyWebviewerMigrationVersion)
      ? Math.max(0, Math.floor(this.settings.noteDrawLegacyWebviewerMigrationVersion))
      : 0;
    if (this.settings.noteBrowserStartupDefaultVersion !== NOTE_BROWSER_STARTUP_DEFAULT_VERSION) {
      this.settings.openOnStartup = false;
      this.settings.browserFrontendMode = "note";
      this.settings.noteBrowserStartupDefaultVersion = NOTE_BROWSER_STARTUP_DEFAULT_VERSION;
      shouldSaveSettings = true;
    }
    this.settings.uiLanguage = typeof this.settings.uiLanguage === "string" && isUiLanguage(this.settings.uiLanguage)
      ? this.settings.uiLanguage
      : DEFAULT_UI_LANGUAGE;
    this.settings.history = Array.isArray(this.settings.history) ? this.settings.history : [];
    this.settings.bookmarks = Array.isArray(this.settings.bookmarks)
      ? this.settings.bookmarks.filter((entry) => entry && typeof entry.url === "string" && !isBuiltInShortcut(entry))
      : [];
    this.settings.readingList = Array.isArray(this.settings.readingList) ? this.settings.readingList : [];
    this.settings.pageCache = Array.isArray(this.settings.pageCache) ? this.settings.pageCache : [];
    this.settings.webNotes = Array.isArray(this.settings.webNotes)
      ? this.settings.webNotes
          .filter((entry) => entry && typeof entry.url === "string")
          .slice(0, MAX_WEB_NOTES)
          .map((entry) => {
            const item = entry as Partial<WebNoteEntry> & { url: string };
            const now = Date.now();
            return {
              id: typeof item.id === "string" && item.id ? item.id : webNoteId(item.url),
              url: item.url,
              title: typeof item.title === "string" && item.title ? item.title : hostName(item.url),
              sourceTitle: typeof item.sourceTitle === "string" ? item.sourceTitle : "",
              noteHtml: typeof item.noteHtml === "string" ? item.noteHtml : "",
              noteText: typeof item.noteText === "string" ? item.noteText : "",
              doodleSvg: typeof item.doodleSvg === "string" ? item.doodleSvg : "",
              pageHtml: typeof item.pageHtml === "string" ? item.pageHtml : "",
              pageText: typeof item.pageText === "string" ? item.pageText : "",
              pageEdits: normalizeBrowserWebTextEdits(item.pageEdits),
              markdownPath: typeof item.markdownPath === "string" ? normalizePath(item.markdownPath) : "",
              updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : now,
              createdAt: typeof item.createdAt === "number" ? item.createdAt : now
            };
          })
      : [];
    this.settings.consoleEntries = Array.isArray(this.settings.consoleEntries) ? this.settings.consoleEntries : [];
    this.settings.downloads = Array.isArray(this.settings.downloads)
      ? this.settings.downloads
          .filter((entry) => entry && typeof entry.url === "string")
          .slice(0, MAX_DOWNLOADS)
          .map((entry) => ({
            id: typeof entry.id === "string" && entry.id ? entry.id : `dl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            url: entry.url,
            fileName: typeof entry.fileName === "string" ? entry.fileName : fileNameFromUrl(entry.url),
            path: typeof entry.path === "string" ? entry.path : "",
            mime: typeof entry.mime === "string" ? entry.mime : "",
            status: ["queued", "downloading", "completed", "error"].includes(entry.status) ? entry.status : "completed",
            format: ["file", "html", "mhtml"].includes(entry.format) ? entry.format : "file",
            bytesReceived: typeof entry.bytesReceived === "number" ? entry.bytesReceived : 0,
            bytesTotal: typeof entry.bytesTotal === "number" ? entry.bytesTotal : 0,
            progress: clampNumber(typeof entry.progress === "number" ? entry.progress : 0, 0, 100),
            connections: clampNumber(typeof entry.connections === "number" ? entry.connections : 1, 1, 8),
            resumable: typeof entry.resumable === "boolean" ? entry.resumable : false,
            message: typeof entry.message === "string" ? entry.message : "",
            time: typeof entry.time === "number" ? entry.time : Date.now()
          }))
      : [];
    this.settings.userScriptsEnabled = typeof this.settings.userScriptsEnabled === "boolean" ? this.settings.userScriptsEnabled : true;
    this.settings.readerUserStyle = typeof this.settings.readerUserStyle === "string" ? this.settings.readerUserStyle : "";
    this.settings.readerUserScript = typeof this.settings.readerUserScript === "string" ? this.settings.readerUserScript : "";
    this.settings.browserFrontendMode = ["note", "web"].includes(this.settings.browserFrontendMode)
      ? this.settings.browserFrontendMode
      : "note";
    this.settings.autoSaveWebNotes = typeof this.settings.autoSaveWebNotes === "boolean" ? this.settings.autoSaveWebNotes : true;
    this.settings.webNoteFolder = typeof this.settings.webNoteFolder === "string" && this.settings.webNoteFolder.trim()
      ? normalizePath(this.settings.webNoteFolder)
      : DEFAULT_WEB_NOTE_FOLDER;
    this.settings.userScriptRules = Array.isArray(this.settings.userScriptRules)
      ? this.settings.userScriptRules
          .filter((rule) => rule && typeof rule === "object")
          .slice(0, 40)
          .map((rule) => {
            const item = rule as Partial<UserScriptRule>;
            return {
              id: typeof item.id === "string" && item.id ? item.id : `script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              name: typeof item.name === "string" && item.name.trim() ? item.name : "脚本",
              match: typeof item.match === "string" && item.match.trim() ? item.match : "*://*/*",
              enabled: typeof item.enabled === "boolean" ? item.enabled : true,
              css: typeof item.css === "string" ? item.css : "",
              js: typeof item.js === "string" ? item.js : "",
              runAt: "reader",
              time: typeof item.time === "number" ? item.time : Date.now()
            };
          })
      : [];
    const existingScriptIds = new Set(this.settings.userScriptRules.map((rule) => rule.id));
    for (const rule of createBuiltInUserScriptRules()) {
      if (!existingScriptIds.has(rule.id)) {
        this.settings.userScriptRules.push(rule);
        existingScriptIds.add(rule.id);
      }
    }
    this.settings.userScriptRules = this.settings.userScriptRules.slice(0, 40);
    this.settings.autofillName = typeof this.settings.autofillName === "string" ? this.settings.autofillName : "";
    this.settings.autofillEmail = typeof this.settings.autofillEmail === "string" ? this.settings.autofillEmail : "";
    this.settings.autofillPhone = typeof this.settings.autofillPhone === "string" ? this.settings.autofillPhone : "";
    this.settings.autofillAddress = typeof this.settings.autofillAddress === "string" ? this.settings.autofillAddress : "";
    this.settings.pageZoom = clampNumber(
      typeof this.settings.pageZoom === "number" ? this.settings.pageZoom : 100,
      50,
      200
    );
    this.settings.desktopMode = typeof this.settings.desktopMode === "boolean" ? this.settings.desktopMode : false;
    this.settings.nightMode = typeof this.settings.nightMode === "boolean" ? this.settings.nightMode : false;
    this.settings.noImageMode = typeof this.settings.noImageMode === "boolean" ? this.settings.noImageMode : false;
    if (this.settings.noImageMode) {
      this.settings.noImageMode = false;
      shouldSaveSettings = true;
    }
    this.settings.eyeProtectionMode = typeof this.settings.eyeProtectionMode === "boolean" ? this.settings.eyeProtectionMode : false;
    this.settings.adBlockEnabled = typeof this.settings.adBlockEnabled === "boolean" ? this.settings.adBlockEnabled : true;
    this.settings.markAdsEnabled = typeof this.settings.markAdsEnabled === "boolean" ? this.settings.markAdsEnabled : false;
    if (this.settings.adBlockEnabled && this.settings.markAdsEnabled) {
      this.settings.markAdsEnabled = false;
    }
    this.settings.incognitoMode = typeof this.settings.incognitoMode === "boolean" ? this.settings.incognitoMode : false;
    this.settings.fullScreenMode = typeof this.settings.fullScreenMode === "boolean" ? this.settings.fullScreenMode : false;
    this.settings.jsDisabled = typeof this.settings.jsDisabled === "boolean" ? this.settings.jsDisabled : false;
    this.settings.rotatedMode = typeof this.settings.rotatedMode === "boolean" ? this.settings.rotatedMode : false;
    this.settings.readerFontScale = clampNumber(
      typeof this.settings.readerFontScale === "number" ? Math.round(this.settings.readerFontScale) : 100,
      80,
      160
    );
    this.settings.userAgentMode = this.settings.userAgentMode === "desktop" ? "desktop" : "mobile";
    this.settings.translateTarget = typeof this.settings.translateTarget === "string" && isTranslateLanguage(this.settings.translateTarget)
      ? this.settings.translateTarget
      : DEFAULT_TRANSLATE_TARGET;
    this.settings.downloadFolder = typeof this.settings.downloadFolder === "string" && this.settings.downloadFolder.trim()
      ? normalizePath(this.settings.downloadFolder)
      : DEFAULT_DOWNLOAD_FOLDER;
    this.settings.downloadConnections = clampNumber(
      typeof this.settings.downloadConnections === "number" ? Math.round(this.settings.downloadConnections) : DEFAULT_DOWNLOAD_CONNECTIONS,
      1,
      8
    );
    this.settings.browserTabs = Array.isArray(this.settings.browserTabs)
      ? this.settings.browserTabs
          .filter((tab) => tab && typeof tab.id === "string" && typeof tab.url === "string")
          .slice(0, MAX_BROWSER_TABS)
          .map((tab) => ({
            id: tab.id,
            title: typeof tab.title === "string" ? tab.title : hostName(tab.url),
            url: tab.url,
            back: Array.isArray(tab.back) ? tab.back.filter((item) => typeof item === "string") : [],
            forward: Array.isArray(tab.forward) ? tab.forward.filter((item) => typeof item === "string") : [],
            time: typeof tab.time === "number" ? tab.time : Date.now()
          }))
      : [];
    // Older builds captured Obsidian's internal file links as localhost HTTP
    // URLs. They are not web pages and must never become the startup target.
    if (isLegacyObsidianFileUrl(this.settings.noteBrowserUrl)) {
      this.settings.noteBrowserUrl = this.settings.homeUrl;
      this.settings.noteBrowserBack = [];
      this.settings.noteBrowserForward = [];
      shouldSaveSettings = true;
    }
    // Deep links are handled when explicitly clicked, but must not become the
    // next implicit NoteBrowser startup target after a reload.
    if (parseObsidianOpenLink(this.settings.noteBrowserUrl)) {
      this.settings.noteBrowserUrl = this.settings.homeUrl;
      this.settings.noteBrowserBack = [];
      this.settings.noteBrowserForward = [];
      shouldSaveSettings = true;
    }
    this.settings.browserTabs = this.settings.browserTabs.map((tab) => {
      if (!isLegacyObsidianFileUrl(tab.url) && !parseObsidianOpenLink(tab.url)) return tab;
      shouldSaveSettings = true;
      return {
        ...tab,
        title: hostName(this.settings.homeUrl),
        url: this.settings.homeUrl,
        back: [],
        forward: [],
        time: Date.now()
      };
    });
    this.ensureBrowserTab(this.settings.activeBrowserTabId);
    if (shouldSaveSettings) {
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class TranslateLanguageModal extends SuggestModal<LanguageOption> {
  plugin: MobileWebviewerPlugin;
  url: string;
  onTranslate: (url: string) => void;

  constructor(app: App, plugin: MobileWebviewerPlugin, url: string, onTranslate: (url: string) => void) {
    super(app);
    this.plugin = plugin;
    this.url = url;
    this.onTranslate = onTranslate;
    this.setPlaceholder(this.plugin.tr("translatePageTo"));
  }

  getSuggestions(query: string): LanguageOption[] {
    const clean = query.trim().toLowerCase();
    if (!clean) return TRANSLATE_CHOICES;
    return TRANSLATE_CHOICES.filter((item) =>
      item.code.toLowerCase().includes(clean) ||
      item.label.toLowerCase().includes(clean) ||
      item.native.toLowerCase().includes(clean)
    );
  }

  renderSuggestion(item: LanguageOption, el: HTMLElement): void {
    el.createDiv({ cls: "mwv-translate-suggest-native", text: item.native });
    el.createDiv({ cls: "mwv-translate-suggest-label", text: `${item.label} · ${item.code}` });
  }

  onChooseSuggestion(item: LanguageOption): void {
    runAsync(async () => {
      this.plugin.settings.translateTarget = item.code;
      await this.plugin.saveSettings();
      this.onTranslate(buildTranslateUrl(this.url, item.code));
    });
  }
}

class MobileWebviewerSettingTab extends PluginSettingTab {
  plugin: MobileWebviewerPlugin;
  private settingsContainerEl?: HTMLElement;

  constructor(app: App, plugin: MobileWebviewerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  renderSectionTitle(containerEl: HTMLElement, text: string, desc?: string): void {
    const section = containerEl.createDiv({ cls: "mwv-settings-section" });
    section.createDiv({ cls: "mwv-settings-section-title", text });
    if (desc) section.createDiv({ cls: "mwv-settings-section-desc", text: desc });
  }

  pluginAssetResourcePath(path: string): string {
    const dir = `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
    return this.app.vault.adapter.getResourcePath(normalizePath(`${dir}/${path}`));
  }

  renderSupportCodes(containerEl: HTMLElement): void {
    const wrapper = containerEl.createDiv({ cls: "mwv-settings-support" });
    wrapper.createDiv({ cls: "mwv-settings-support-title", text: this.plugin.tr("supportCodes") });
    wrapper.createDiv({
      cls: "mwv-settings-support-desc",
      text: this.plugin.tr("supportCodesDesc")
    });
    const grid = wrapper.createDiv({ cls: "mwv-settings-support-grid" });
    for (const item of SUPPORT_CODE_ASSETS) {
      const card = grid.createDiv({ cls: "mwv-settings-support-card" });
      const src = this.pluginAssetResourcePath(item.path);
      card.createEl("img", {
        cls: "mwv-settings-support-image",
        attr: { src, alt: item.label, loading: "lazy" }
      });
      card.createDiv({ cls: "mwv-settings-support-label", text: item.label });
    }
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      name: "Mobile Webviewer",
      render: (setting) => {
        setting.settingEl.empty();
        setting.settingEl.addClass("mwv-settings-definition-root");
        this.renderSettings(setting.settingEl);
      }
    }];
  }

  refreshSettings(): void {
    if (this.settingsContainerEl?.isConnected) {
      this.renderSettings(this.settingsContainerEl);
    }
  }

  renderSettings(containerEl: HTMLElement): void {
    this.settingsContainerEl = containerEl;
    containerEl.empty();
    containerEl.addClass("mwv-settings");

    this.renderSectionTitle(containerEl, this.plugin.tr("coreEntry"), this.plugin.tr("coreEntryDesc"));

    new Setting(containerEl)
      .setName(this.plugin.tr("uiLanguage"))
      .setDesc(this.plugin.tr("uiLanguageDesc"))
      .addDropdown((dropdown) => {
        for (const language of UI_LANGUAGE_CHOICES) {
          dropdown.addOption(language.code, `${language.native} / ${language.label}`);
        }
        dropdown
          .setValue(this.plugin.settings.uiLanguage || DEFAULT_UI_LANGUAGE)
          .onChange(async (value) => {
            this.plugin.settings.uiLanguage = isUiLanguage(value) ? value : DEFAULT_UI_LANGUAGE;
            await this.plugin.saveSettings();
            this.refreshSettings();
          });
      });

    new Setting(containerEl)
      .setName(this.plugin.tr("homePage"))
      .setDesc(this.plugin.tr("homePageDesc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_HOME)
          .setValue(this.plugin.settings.homeUrl)
          .onChange(async (value) => {
            this.plugin.settings.homeUrl = normalizeInput(value || DEFAULT_HOME, this.plugin.settings.searchUrl);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("searchUrl"))
      .setDesc(this.plugin.tr("searchUrlDesc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SEARCH)
          .setValue(this.plugin.settings.searchUrl)
          .onChange(async (value) => {
            this.plugin.settings.searchUrl = value || DEFAULT_SEARCH;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("noteBrowserCurrentUrl"))
      .setDesc(this.plugin.tr("noteBrowserCurrentUrlDesc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_HOME)
          .setValue(this.plugin.settings.noteBrowserUrl)
          .onChange(async (value) => {
            this.plugin.settings.noteBrowserUrl = normalizeInput(value || DEFAULT_HOME, this.plugin.settings.searchUrl);
            await this.plugin.saveSettings();
          })
      )
      .addButton((button) =>
        button
          .setButtonText(this.plugin.tr("home"))
          .onClick(async () => {
            this.plugin.settings.noteBrowserUrl = this.plugin.settings.homeUrl;
            this.plugin.settings.noteBrowserBack = [];
            this.plugin.settings.noteBrowserForward = [];
            await this.plugin.saveSettings();
            this.refreshSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("openBrowser"))
      .setDesc(this.plugin.tr("openBrowserDesc"))
      .addButton((button) =>
        button
          .setButtonText(this.plugin.tr("noteBrowser"))
          .onClick(() => void this.plugin.openNoteBrowser(this.plugin.settings.noteBrowserUrl || this.plugin.settings.homeUrl))
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("openOnStartup"))
      .setDesc(this.plugin.tr("openOnStartupDesc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.openOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    this.renderSectionTitle(containerEl, this.plugin.tr("interfaceRendering"), this.plugin.tr("interfaceRenderingDesc"));

    new Setting(containerEl)
      .setName(this.plugin.tr("compactMobileToolbar"))
      .setDesc(this.plugin.tr("compactMobileToolbarDesc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.compactToolbar)
          .onChange(async (value) => {
            this.plugin.settings.compactToolbar = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("showNoteDrawMagicWand"))
      .setDesc(this.plugin.tr("showNoteDrawMagicWandDesc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showFloatingWand)
          .onChange(async (value) => {
            this.plugin.settings.showFloatingWand = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("readerHint"))
      .setDesc(this.plugin.tr("readerHintDesc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showReaderHint)
          .onChange(async (value) => {
            this.plugin.settings.showReaderHint = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("liveBrowserFirst"))
      .setDesc(this.plugin.tr("liveBrowserFirstDesc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.liveBrowserFirst)
          .onChange(async (value) => {
            this.plugin.settings.liveBrowserFirst = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("frontendMode"))
      .setDesc(this.plugin.tr("frontendModeDesc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("note", this.plugin.tr("editableNote"))
          .addOption("web", this.plugin.tr("fullWebPage"))
          .setValue(this.plugin.settings.browserFrontendMode)
          .onChange(async (value) => {
            this.plugin.settings.browserFrontendMode = value as "note" | "web" | "split";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("autoSaveWebNotes"))
      .setDesc(this.plugin.tr("autoSaveWebNotesDesc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSaveWebNotes)
          .onChange(async (value) => {
            this.plugin.settings.autoSaveWebNotes = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("webNoteFolder"))
      .setDesc(this.plugin.tr("webNoteFolderDesc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_WEB_NOTE_FOLDER)
          .setValue(this.plugin.settings.webNoteFolder)
          .onChange(async (value) => {
            this.plugin.settings.webNoteFolder = normalizePath(value || DEFAULT_WEB_NOTE_FOLDER);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("pageZoom"))
      .setDesc(this.plugin.tr("pageZoomDesc"))
      .addSlider((slider) =>
        slider
          .setLimits(50, 200, 10)

          .setValue(this.plugin.settings.pageZoom)
          .onChange(async (value) => {
            this.plugin.settings.pageZoom = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("readerFontSize"))
      .setDesc(this.plugin.tr("readerFontSizeDesc"))
      .addSlider((slider) =>
        slider
          .setLimits(80, 160, 10)

          .setValue(this.plugin.settings.readerFontScale)
          .onChange(async (value) => {
            this.plugin.settings.readerFontScale = clampNumber(Math.round(value), 80, 160);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("desktopView"))
      .setDesc(this.plugin.tr("desktopViewDesc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.desktopMode)
          .onChange(async (value) => {
            this.plugin.settings.desktopMode = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("userAgent"))
      .setDesc(this.plugin.tr("userAgentDesc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("mobile", this.plugin.tr("mobile"))
          .addOption("desktop", this.plugin.tr("desktop"))
          .setValue(this.plugin.settings.userAgentMode)
          .onChange(async (value) => {
            this.plugin.settings.userAgentMode = value === "desktop" ? "desktop" : "mobile";
            await this.plugin.saveSettings();
          })
      );

    this.renderSectionTitle(containerEl, this.plugin.tr("download"), this.plugin.tr("downloadDesc"));

    new Setting(containerEl)
      .setName(this.plugin.tr("downloadFolder"))
      .setDesc(this.plugin.tr("downloadFolderDesc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_DOWNLOAD_FOLDER)
          .setValue(this.plugin.settings.downloadFolder)
          .onChange(async (value) => {
            this.plugin.settings.downloadFolder = normalizePath(value || DEFAULT_DOWNLOAD_FOLDER);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("downloadConnections"))
      .setDesc(this.plugin.tr("downloadConnectionsDesc"))
      .addSlider((slider) =>
        slider
          .setLimits(1, 8, 1)

          .setValue(this.plugin.settings.downloadConnections)
          .onChange(async (value) => {
            this.plugin.settings.downloadConnections = clampNumber(Math.round(value), 1, 8);
            await this.plugin.saveSettings();
          })
      );

    this.renderSectionTitle(containerEl, this.plugin.tr("browserMode"), this.plugin.tr("browserModeDesc"));
    for (const option of [
      [this.plugin.tr("nightMode"), "nightMode", this.plugin.tr("nightModeDesc")],
      [this.plugin.tr("eyeProtection"), "eyeProtectionMode", this.plugin.tr("eyeProtectionDesc")],
      [this.plugin.tr("adBlock"), "adBlockEnabled", this.plugin.tr("adBlockDesc")],
      [this.plugin.tr("markAds"), "markAdsEnabled", this.plugin.tr("markAdsDesc")],
      [this.plugin.tr("incognito"), "incognitoMode", this.plugin.tr("incognitoDesc")],
      [this.plugin.tr("disableJavaScript"), "jsDisabled", this.plugin.tr("disableJavaScriptDesc")],
      [this.plugin.tr("rotateScreen"), "rotatedMode", this.plugin.tr("rotateScreenDesc")]
    ] as const) {
      new Setting(containerEl)
        .setName(option[0])
        .setDesc(option[2])
        .addToggle((toggle) =>
          toggle
            .setValue(Boolean(this.plugin.settings[option[1]]))
            .onChange(async (value) => {
              (this.plugin.settings as unknown as Record<string, boolean>)[option[1]] = value;
              await this.plugin.saveSettings();
          })
      );
    }

    this.renderSectionTitle(containerEl, this.plugin.tr("dataImportExport"), this.plugin.tr("dataImportExportDesc"));

    new Setting(containerEl)
      .setName(this.plugin.tr("universalExport"))
      .setDesc(this.plugin.tr("universalExportDesc"))
      .addButton((button) =>
        button
          .setButtonText(this.plugin.tr("exportJson"))
          .onClick(async () => {
            await this.plugin.savePortableExportFile();
          })
      )
      .addButton((button) =>
        button
          .setButtonText(this.plugin.tr("copyJson"))
          .onClick(async () => {
            await this.plugin.copyPortableExport();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("universalImport"))
      .setDesc(this.plugin.tr("universalImportDesc"))
      .addButton((button) =>
        button
          .setButtonText(this.plugin.tr("importClipboard"))
          .onClick(async () => {
            await this.plugin.importPortableDataFromClipboard();
            this.refreshSettings();
          })
      );

    this.renderSectionTitle(containerEl, this.plugin.tr("translation"), this.plugin.tr("translationDesc"));

    new Setting(containerEl)
      .setName(this.plugin.tr("defaultTranslationLanguage"))
      .setDesc(this.plugin.tr("defaultTranslationLanguageDesc"))
      .addDropdown((dropdown) => {
        for (const language of TRANSLATE_CHOICES) {
          dropdown.addOption(language.code, `${language.native} / ${language.label}`);
        }
        dropdown
          .setValue(this.plugin.settings.translateTarget)
          .onChange(async (value) => {
            this.plugin.settings.translateTarget = isTranslateLanguage(value) ? value : DEFAULT_TRANSLATE_TARGET;
            await this.plugin.saveSettings();
          });
      });

    this.renderSectionTitle(containerEl, this.plugin.tr("scriptsReader"), this.plugin.tr("scriptsReaderDesc"));

    new Setting(containerEl)
      .setName(this.plugin.tr("readerUserScripts"))
      .setDesc(this.plugin.tr("readerUserScriptsDesc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.userScriptsEnabled)
          .onChange(async (value) => {
            this.plugin.settings.userScriptsEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("readerCss"))
      .setDesc(this.plugin.tr("readerCssDesc"))
      .addTextArea((text) =>
        text
          .setPlaceholder(".mwv-md-content p { line-height: 1.7; }")
          .setValue(this.plugin.settings.readerUserStyle)
          .onChange(async (value) => {
            this.plugin.settings.readerUserStyle = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("readerJavascript"))
      .setDesc(this.plugin.tr("readerJavascriptDesc"))
      .addTextArea((text) =>
        text
          .setPlaceholder("Custom reader JavaScript")
          .setValue(this.plugin.settings.readerUserScript)
          .onChange(async (value) => {
            this.plugin.settings.readerUserScript = value;
            await this.plugin.saveSettings();
          })
      );

    this.renderSectionTitle(containerEl, this.plugin.tr("userScriptRules"));
    new Setting(containerEl)
      .setName(this.plugin.tr("rulesCount", { count: this.plugin.settings.userScriptRules.length }))
      .setDesc(this.plugin.tr("rulesDesc"))
      .addButton((button) =>
        button
          .setButtonText(this.plugin.tr("addRule"))
          .onClick(async () => {
            this.plugin.settings.userScriptRules.unshift(createDefaultUserScriptRule());
            await this.plugin.saveSettings();
            this.refreshSettings();
          })
      );

    for (const rule of this.plugin.settings.userScriptRules) {
      const group = containerEl.createDiv({ cls: "mwv-script-rule-setting" });
      new Setting(group)
        .setName(rule.name || "脚本")
        .setDesc(rule.match || "*://*/*")
        .addToggle((toggle) =>
          toggle
            .setValue(rule.enabled)
            .onChange(async (value) => {
              rule.enabled = value;
              await this.plugin.saveSettings();
            })
        )
        .addText((text) =>
          text
            .setPlaceholder(this.plugin.tr("ruleName"))
            .setValue(rule.name)
            .onChange(async (value) => {
              rule.name = value || "脚本";
              await this.plugin.saveSettings();
            })
        )
        .addButton((button) =>
          button
            .setButtonText(this.plugin.tr("delete"))
            .onClick(async () => {
              this.plugin.settings.userScriptRules = this.plugin.settings.userScriptRules.filter((item) => item.id !== rule.id);
              await this.plugin.saveSettings();
              this.refreshSettings();
            })
        );

      new Setting(group)
        .setName(this.plugin.tr("match"))
        .setDesc(this.plugin.tr("matchDesc"))
        .addText((text) =>
          text
            .setPlaceholder("*://*/*")
            .setValue(rule.match)
            .onChange(async (value) => {
              rule.match = value || "*://*/*";
              await this.plugin.saveSettings();
            })
        );

      new Setting(group)
        .setName(this.plugin.tr("css"))
        .setDesc(this.plugin.tr("cssDesc"))
        .addTextArea((text) =>
          text
            .setPlaceholder(".mwv-md-content p { line-height: 1.7; }")
            .setValue(rule.css)
            .onChange(async (value) => {
              rule.css = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(group)
        .setName(this.plugin.tr("javascript"))
        .setDesc(this.plugin.tr("javascriptDesc"))
        .addTextArea((text) =>
          text
            .setPlaceholder("Custom JavaScript")
            .setValue(rule.js)
            .onChange(async (value) => {
              rule.js = value;
              await this.plugin.saveSettings();
            })
        );
    }

    this.renderSectionTitle(containerEl, this.plugin.tr("autofill"), this.plugin.tr("autofillDesc"));

    new Setting(containerEl)
      .setName(this.plugin.tr("autofillName"))
      .setDesc(this.plugin.tr("autofillFieldDesc"))
      .addText((text) =>
        text
          .setValue(this.plugin.settings.autofillName)
          .onChange(async (value) => {
            this.plugin.settings.autofillName = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("autofillEmail"))
      .setDesc(this.plugin.tr("autofillFieldDesc"))
      .addText((text) =>
        text
          .setValue(this.plugin.settings.autofillEmail)
          .onChange(async (value) => {
            this.plugin.settings.autofillEmail = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("autofillPhone"))
      .setDesc(this.plugin.tr("autofillFieldDesc"))
      .addText((text) =>
        text
          .setValue(this.plugin.settings.autofillPhone)
          .onChange(async (value) => {
            this.plugin.settings.autofillPhone = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("autofillAddress"))
      .setDesc(this.plugin.tr("autofillFieldDesc"))
      .addText((text) =>
        text
          .setValue(this.plugin.settings.autofillAddress)
          .onChange(async (value) => {
            this.plugin.settings.autofillAddress = value;
            await this.plugin.saveSettings();
          })
      );

    this.renderSectionTitle(containerEl, this.plugin.tr("dataMaintenance"), this.plugin.tr("dataMaintenanceDesc"));

    new Setting(containerEl)
      .setName(this.plugin.tr("clearHistory"))
      .setDesc(this.plugin.tr("savedEntries", { count: this.plugin.settings.history.length }))
      .addButton((button) =>
        button
          .setButtonText(this.plugin.tr("clear"))
          .onClick(async () => {
            this.plugin.settings.history = [];
            await this.plugin.saveSettings();
            this.refreshSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("clearReaderCache"))
      .setDesc(this.plugin.tr("cachedPages", { count: this.plugin.settings.pageCache.length }))
      .addButton((button) =>
        button
          .setButtonText(this.plugin.tr("clear"))
          .onClick(async () => {
            await this.plugin.clearCache();
            this.refreshSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("clearDownloads"))
      .setDesc(this.plugin.tr("downloadRecords", { count: this.plugin.settings.downloads.length }))
      .addButton((button) =>
        button
          .setButtonText(this.plugin.tr("clear"))
          .onClick(async () => {
            this.plugin.settings.downloads = [];
            await this.plugin.saveSettings();
            this.refreshSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("readingList"))
      .setDesc(this.plugin.tr("savedPages", { count: this.plugin.settings.readingList.length }))
      .addButton((button) =>
        button
          .setButtonText(this.plugin.tr("clear"))
          .onClick(async () => {
            this.plugin.settings.readingList = [];
            await this.plugin.saveSettings();
            this.refreshSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("clearConsole"))
      .setDesc(this.plugin.tr("consoleEntries", { count: this.plugin.settings.consoleEntries.length }))
      .addButton((button) =>
        button
          .setButtonText(this.plugin.tr("clear"))
          .onClick(async () => {
            this.plugin.settings.consoleEntries = [];
            await this.plugin.saveSettings();
            this.refreshSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("clearBrowsingData"))
      .setDesc(this.plugin.tr("clearBrowsingDataDesc"))
      .addButton((button) =>
        button
          .setButtonText(this.plugin.tr("clear"))
          .onClick(async () => {
            await this.plugin.clearBrowsingData();
            this.refreshSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.tr("exportBookmarkNote"))
      .setDesc(this.plugin.tr("exportBookmarkNoteDesc"))
      .addButton((button) =>
        button
          .setButtonText(this.plugin.tr("create"))
          .onClick(async () => {
            const lines = [
              "# Mobile Webviewer Bookmarks",
              "",
              ...this.plugin.settings.bookmarks.map((entry) => `- [${entry.title}](${entry.url})`)
            ];
            const path = normalizePath("Mobile Webviewer Bookmarks.md");
            const existing = this.app.vault.getAbstractFileByPath(path);
            if (existing instanceof TFile) {
              await this.app.vault.modify(existing, lines.join("\n"));
            } else {
              await this.app.vault.create(path, lines.join("\n"));
            }
            new Notice(this.plugin.tr("bookmarkNoteCreated"));
          })
      );

    this.renderSupportCodes(containerEl);
  }
}
