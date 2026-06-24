import {
  App,
  ItemView,
  Menu,
  Notice,
  Plugin,
  PluginSettingTab,
  getLanguage,
  requestUrl,
  Setting,
  SuggestModal,
  TFile,
  WorkspaceLeaf,
  normalizePath,
  setIcon
} from "obsidian";

const VIEW_TYPE = "mobile-webviewer-view";
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
const MAX_WEB_NOTES = 80;
const DEFAULT_DOWNLOAD_FOLDER = "Mobile Webviewer Downloads";
const DEFAULT_WEB_NOTE_FOLDER = "Mobile Webviewer Notes";
const DEFAULT_DOWNLOAD_CONNECTIONS = 4;
const MIN_SEGMENTED_DOWNLOAD_BYTES = 2 * 1024 * 1024;
const MAX_MHTML_RESOURCES = 24;
const DEFAULT_TRANSLATE_TARGET = "ob";
const BINARY_URL_PATTERN = /\.(zip|7z|rar|exe|msi|apk|dmg|pkg|pdf|docx?|xlsx?|pptx?|mp[34]|m4a|wav|flac|jpg|jpeg|png|gif|webp|svg|torrent)([?#].*)?$/i;
const NOTEDRAW_BUTTON_SELECTOR = ".notedraw-header-button, .notedraw-webview-button, .notedraw-fallback-button, .notedraw-webview-inline-button";
const MWV_DEDUPE_ROOT_SELECTOR = ".mwv-root, .mwv-note-embed, .mwv-embed, .workspace-leaf-content[data-type='mobile-webviewer-view']";

const FOLLOW_OBSIDIAN_TRANSLATE_OPTION: LanguageOption = {
  code: "ob",
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

interface WebNoteEntry {
  id: string;
  url: string;
  title: string;
  sourceTitle: string;
  noteHtml: string;
  noteText: string;
  doodleSvg: string;
  markdownPath: string;
  updatedAt: number;
  createdAt: number;
}

interface LanguageOption {
  code: string;
  label: string;
  native: string;
}

interface MobileWebviewerSettings {
  homeUrl: string;
  searchUrl: string;
  openOnStartup: boolean;
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
  openDevTools?: () => void;
  getWebContentsId?: () => number;
  isLoading?: () => boolean;
}

type BrowserSurfaceElement = HTMLIFrameElement | ElectronWebviewElement;

interface BrowserSurfaceCallbacks {
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
}

interface WebNotePanelElement extends HTMLElement {
  _mwvFinishDoodle?: () => void;
  _mwvFlushWebNote?: () => void | Promise<void>;
}

interface NoteDrawControllerLike {
  active?: boolean;
  previewEl?: HTMLElement;
  button?: HTMLElement;
  surfaceType?: string;
  toggle?: () => void | Promise<void>;
  onButtonClick?: (event?: Event) => void | Promise<void>;
  onButtonPointerDown?: (event?: Event) => void | Promise<void>;
  onButtonPointerUp?: (event?: Event) => void | Promise<void>;
}

interface NoteDrawButtonElement extends HTMLElement {
  _noteDrawController?: NoteDrawControllerLike;
}

interface NoteDrawSurfaceElement extends HTMLElement {
  _noteDrawController?: NoteDrawControllerLike;
}

interface NoteDrawWindowApi {
  getActiveController?: () => NoteDrawControllerLike | null;
}

const DEFAULT_SETTINGS: MobileWebviewerSettings = {
  homeUrl: DEFAULT_HOME,
  searchUrl: DEFAULT_SEARCH,
  openOnStartup: false,
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
  bookmarks: []
};

function normalizeInput(input: string, searchUrl: string): string {
  const value = input.trim();
  if (!value) return DEFAULT_HOME;

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

function hostName(url: string): string {
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
  const image = root.querySelector<HTMLImageElement>("img[src], img[data-src], img[data-original]");
  const raw = image?.getAttribute("src") ?? image?.getAttribute("data-src") ?? image?.getAttribute("data-original") ?? "";
  if (!raw || raw.startsWith("data:")) return undefined;
  return absoluteUrl(raw, baseUrl);
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

function wildcardMatch(pattern: string, value: string): boolean {
  const clean = pattern.trim();
  if (!clean || clean === "*") return true;
  const escaped = clean.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

function sanitizeFileName(value: string, fallback = "download"): string {
  const clean = value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
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

function arrayBufferToText(buffer: ArrayBuffer): string {
  return new TextDecoder("utf-8").decode(buffer);
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
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
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
    if (!(node instanceof HTMLElement)) return;
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
  return normalizeTranslateLanguageCode(getLanguage());
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
  activeDoodlePath?: SVGPathElement;
  activeDoodlePointerId?: number;
  activeDoodleSvg?: SVGSVGElement;
  currentDrawer: "bookmarks" | "history" | "reading" | "downloads" | "console" = "bookmarks";

  constructor(leaf: WorkspaceLeaf, plugin: MobileWebviewerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Mobile Webviewer Browser";
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
        placeholder: "Search or enter URL",
        list: "mwv-address-suggestions"
      }
    });
    this.plugin.renderUrlSuggestions(form, "mwv-address-suggestions");
    const goButton = form.createEl("button", {
      cls: "mwv-icon-button mwv-primary",
      attr: { type: "submit", "aria-label": "Go" }
    });
    setIcon(goButton, "arrow-right");

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.navigate(normalizeInput(this.addressEl.value, this.plugin.settings.searchUrl), true);
    });

    const meta = header.createDiv({ cls: "mwv-meta" });
    this.titleEl = meta.createDiv({ cls: "mwv-title", text: "Mobile Webviewer Browser" });
    this.subtitleEl = meta.createDiv({ cls: "mwv-subtitle", text: "Ready" });
    this.tabStripEl = header.createDiv({ cls: "mwv-tab-strip" });

    const frameWrap = root.createDiv({ cls: "mwv-frame-wrap" });
    this.homeEl = frameWrap.createDiv({ cls: "mwv-home mwv-virtual-md" });
    this.buildHome();

    this.surfaceEl = this.plugin.createBrowserSurface(frameWrap, "", "mwv-frame", "Mobile Webviewer Browser", {
      onReady: () => this.handleSurfaceReady(),
      onNavigate: (url) => this.handleSurfaceNavigate(url),
      onTitle: (title) => this.handleSurfaceTitle(title),
      onFail: (message, url) => {
        this.subtitleEl.setText(message);
        void this.plugin.addConsole("warn", `Page load issue: ${message}`, url ?? this.currentUrl);
      },
      onConsole: (level, message, url) => this.plugin.addConsole(level, message, url ?? this.currentUrl),
      onNewWindow: (url) => this.openPopupTab(url),
      onLoading: (loading, url) => this.handleSurfaceLoading(loading, url),
      onFavicon: (iconUrl) => this.plugin.addConsole("info", `Favicon: ${iconUrl}`, this.currentUrl),
      onDownloadCandidate: (downloadUrl) => this.handleSurfaceDownload(downloadUrl),
      onContextLink: (linkUrl, linkTitle) => this.setContextLink(linkUrl, linkTitle)
    });
    this.plugin.applyFrameViewPreferences(this.surfaceEl);
    this.surfaceEl.addEventListener("contextmenu", (event) => {
      const contextUrl = this.addressEl.title && /^https?:\/\//i.test(this.addressEl.title) ? this.addressEl.title : this.currentUrl;
      this.openLinkContextMenu(event as MouseEvent, contextUrl, this.currentTitle || hostName(contextUrl));
    });

    this.drawerEl = root.createDiv({ cls: "mwv-drawer" });
    const drawerHead = this.drawerEl.createDiv({ cls: "mwv-drawer-head" });
    const tabs = drawerHead.createDiv({ cls: "mwv-tabs" });
    this.bookmarksTabEl = tabs.createEl("button", { cls: "mwv-tab is-active", text: "Bookmarks" });
    this.historyTabEl = tabs.createEl("button", { cls: "mwv-tab", text: "History" });
    this.readingTabEl = tabs.createEl("button", { cls: "mwv-tab", text: "Reading" });
    this.downloadsTabEl = tabs.createEl("button", { cls: "mwv-tab", text: "Downloads" });
    this.consoleTabEl = tabs.createEl("button", { cls: "mwv-tab", text: "Console" });
    const closeDrawer = drawerHead.createEl("button", {
      cls: "mwv-icon-button",
      attr: { type: "button", "aria-label": "Close panel" }
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
    this.makeToolButton(toolbar, "arrow-left", "Back", () => this.goBack());
    this.makeToolButton(toolbar, "arrow-right", "Forward", () => this.goForward());
    this.makeToolButton(toolbar, "rotate-cw", "Reload", () => this.reload());
    this.makeToolButton(toolbar, "home", "Home", () => this.navigate(this.plugin.settings.homeUrl, true));
    this.makeModeButton(toolbar, "file-text", "笔记", "note");
    this.makeModeButton(toolbar, "globe-2", "网页", "web");
    this.makeModeButton(toolbar, "panel-top", "分屏", "split");
    this.makeToolButton(toolbar, "star", "Bookmark", () => this.toggleBookmark());
    this.makeToolButton(toolbar, "book-open", "Bookmarks", () => this.openDrawer("bookmarks"));
    this.makeToolButton(toolbar, "history", "History", () => this.openDrawer("history"));
    this.makeToolButton(toolbar, "download", "Downloads", () => this.openDrawer("downloads"));
    this.makeToolButton(toolbar, "plus-square", "Save link", () => this.captureLink());
    this.makeToolButton(toolbar, "more-horizontal", "More", (button) => this.openMoreMenu(button));
    if (this.plugin.settings.showFloatingWand) {
      this.makeToolButton(toolbar, "wand-sparkles", "NoteDraw", () => this.triggerNoteDraw()).addClass("mwv-notedraw-launcher");
    }
    this.makeToolButton(toolbar, "settings", "Settings", () => this.plugin.openSettings());

    this.renderDrawer("bookmarks");
    this.plugin.queueNoteDrawButtonDedupe(root);
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
    this.plugin.setBrowserSurfaceUrl(this.surfaceEl, url);
  }

  handleSurfaceReady(): void {
    void this.plugin.applyAccessibleFrameFilters(this.surfaceEl, this.currentUrl);
    this.subtitleEl.setText(hostName(this.currentUrl));
    const title = this.plugin.getBrowserSurfaceTitle(this.surfaceEl);
    if (title) {
      this.handleSurfaceTitle(title);
    }
  }

  handleSurfaceTitle(title: string): void {
    if (!title.trim()) return;
    this.currentTitle = title.trim();
    this.titleEl.setText(this.currentTitle);
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
    new Notice(`Download complete: ${entry.path || entry.message}`);
    this.openDrawer("downloads");
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
    void this.syncActiveBrowserTab();
    this.renderTabStrip();
    if (mode !== "programmatic" || previous !== nextUrl) {
      void this.plugin.addHistory({
        title: this.currentTitle,
        url: nextUrl,
        time: Date.now()
      });
    }
  }

  applyBrowserTab(tab: BrowserTab): void {
    this.currentUrl = tab.url || this.plugin.settings.homeUrl;
    this.currentTitle = tab.title || hostName(this.currentUrl);
    this.backStack = Array.isArray(tab.back) ? [...tab.back] : [];
    this.forwardStack = Array.isArray(tab.forward) ? [...tab.forward] : [];
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
      item.addEventListener("click", async (event) => {
        const target = event.target as HTMLElement | null;
        event.preventDefault();
        event.stopPropagation();
        if (target?.closest(".mwv-browser-tab-close")) {
          await this.closeBrowserTab(tab.id);
        } else {
          await this.switchBrowserTab(tab.id);
        }
      });
    }

    const add = this.tabStripEl.createEl("button", {
      cls: "mwv-browser-tab-add",
      attr: { type: "button", title: "New Obsidian tab", "aria-label": "New Obsidian tab" }
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
          ? "No bookmarks yet"
          : kind === "reading"
            ? "No reading list yet"
            : "No history yet";
      this.listEl.createDiv({ cls: "mwv-empty", text: label });
      return;
    }

    for (const entry of entries.slice(0, 12)) {
      const item = this.listEl.createEl("button", { cls: "mwv-list-item", attr: { type: "button" } });
      item.createDiv({ cls: "mwv-list-title", text: entry.title || hostName(entry.url) });
      item.createDiv({ cls: "mwv-list-url", text: entry.url });
      item.addEventListener("click", () => this.navigate(entry.url, true));
    }
  }

  renderDownloadsDrawer(): void {
    if (!this.listEl) return;
    const entries = this.plugin.settings.downloads.slice(0, 40);
    if (!entries.length) {
      this.listEl.createDiv({ cls: "mwv-empty", text: "No downloads yet" });
      return;
    }

    for (const entry of entries) {
      const item = this.listEl.createDiv({ cls: `mwv-download-list-item is-${entry.status}` });
      const top = item.createDiv({ cls: "mwv-download-list-top" });
      top.createDiv({ cls: "mwv-download-list-title", text: entry.fileName || hostName(entry.url) });
      top.createDiv({ cls: "mwv-download-list-state", text: `${entry.status} · ${Math.round(entry.progress)}%` });
      const progress = item.createDiv({ cls: "mwv-download-progress" });
      progress.createDiv({ cls: "mwv-download-progress-fill", attr: { style: `width:${clampNumber(entry.progress, 0, 100)}%` } });
      item.createDiv({ cls: "mwv-download-list-url", text: entry.url });
      item.createDiv({ cls: "mwv-download-list-path", text: entry.path || entry.message });
      const row = item.createDiv({ cls: "mwv-download-list-actions" });
      const open = row.createEl("button", { cls: "mwv-mini-action", text: "打开", attr: { type: "button" } });
      open.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.plugin.openDownloadEntry(entry);
      });
      const copy = row.createEl("button", { cls: "mwv-mini-action", text: "复制路径", attr: { type: "button" } });
      copy.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.plugin.copyDownloadPath(entry);
      });
      const locate = row.createEl("button", { cls: "mwv-mini-action", text: "位置", attr: { type: "button" } });
      locate.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.plugin.revealDownloadEntry(entry);
      });
    }
  }

  renderConsoleDrawer(): void {
    if (!this.listEl) return;
    const entries = this.plugin.settings.consoleEntries.slice(0, 30);
    if (!entries.length) {
      this.listEl.createDiv({ cls: "mwv-empty", text: "No console logs" });
      return;
    }

    for (const entry of entries) {
      const item = this.listEl.createDiv({ cls: `mwv-console-list-item is-${entry.level}` });
      item.createDiv({ cls: "mwv-console-list-meta", text: `${entry.level.toUpperCase()} · ${new Date(entry.time).toLocaleTimeString()}` });
      item.createDiv({ cls: "mwv-console-list-message", text: entry.message });
      if (entry.url) item.createDiv({ cls: "mwv-console-list-url", text: entry.url });
    }
  }

  buildHome(query = "", results: SearchResult[] = []): void {
    if (!this.homeEl) return;
    this.homeEl.empty();

    const article = this.homeEl.createEl("article", { cls: "mwv-note-surface mwv-search-note" });
    article.createDiv({ cls: "mwv-note-source", text: "Mobile Webviewer / Bing backend" });
    article.createEl("h1", { text: query ? `Search: ${query}` : "Search" });

    const form = article.createEl("form", { cls: "mwv-home-search" });
    const icon = form.createSpan({ cls: "mwv-home-search-icon", attr: { "aria-hidden": "true" } });
    setIcon(icon, "search");
    const input = form.createEl("input", {
      cls: "mwv-home-input",
      value: query,
      attr: {
        type: "search",
        placeholder: "Search Bing",
        autocomplete: "off"
      }
    });
    const button = form.createEl("button", { cls: "mwv-home-go", attr: { type: "submit", "aria-label": "Search" } });
    setIcon(button, "arrow-right");

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.searchBing(input.value);
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
          text: "更多结果",
          attr: { type: "button" }
        });
        more.addEventListener("click", async () => {
          more.disabled = true;
          more.setText("加载中...");
          const nextMax = Math.min(80, Math.max(results.length + BING_DEFAULT_MAX_RESULTS, BING_DEFAULT_MAX_RESULTS * 2));
          const nextPages = Math.ceil(nextMax / BING_RESULTS_PER_PAGE);
          try {
            const expanded = await this.plugin.searchBing(query, nextPages, nextMax);
            this.subtitleEl.setText(`${expanded.length} result(s)`);
            this.buildHome(query, expanded);
          } catch (error) {
            console.error("[mobile-webviewer] Bing more results failed", error);
            more.disabled = false;
            more.setText("加载失败，重试");
          }
        });
      }
    }
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
      consolePanel.createDiv({ cls: "mwv-console-empty", text: "暂无日志。执行搜索、下载、保存、脚本后会出现在这里。" });
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
      ".mwv-downloads-panel",
      ".mwv-tools-panel"
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
    toolsPanel.createDiv({ cls: "mwv-tools-title", text: "浏览器状态" });
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
      .setTitle("打开链接")
      .setIcon("arrow-right")
      .onClick(() => this.navigate(url, true)));
    menu.addItem((item) => item
      .setTitle("新标签打开")
      .setIcon("plus")
      .onClick(() => void this.newBrowserTab(url)));
    menu.addItem((item) => item
      .setTitle("复制链接")
      .setIcon("copy")
      .onClick(async () => {
        await navigator.clipboard.writeText(`[${title || hostName(url)}](${url})`);
        new Notice("Copied link");
      }));
    menu.addItem((item) => item
      .setTitle("下载链接")
      .setIcon("download")
      .onClick(() => void this.handleSurfaceDownload(url)));
    menu.showAtMouseEvent(event);
  }

  navigate(url: string, pushHistory: boolean): void {
    const nextUrl = normalizeInput(url, this.plugin.settings.searchUrl);
    this.flushCurrentWebNoteBeforeRender();
    const query = this.extractBingQuery(nextUrl);
    if (this.isBingHome(nextUrl) || query !== null) {
      if (pushHistory && this.currentUrl && this.currentUrl !== nextUrl) {
        this.backStack.push(this.currentUrl);
        this.forwardStack = [];
      }
      if (query) {
        this.searchBing(query, nextUrl);
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
    this.subtitleEl.setText("Reading...");
    this.renderUrlAsNote(nextUrl);
    void this.syncActiveBrowserTab();
    this.renderTabStrip();
    void this.plugin.addHistory({
      title: this.currentTitle,
      url: nextUrl,
      time: Date.now()
    });
  }

  goBack(): void {
    if (this.plugin.isElectronWebview(this.surfaceEl) && this.surfaceEl.canGoBack?.()) {
      this.surfaceNavMode = "back";
      this.surfaceEl.goBack?.();
      return;
    }
    const previous = this.backStack.pop();
    if (!previous) {
      new Notice("No previous page");
      return;
    }
    if (this.currentUrl) this.forwardStack.push(this.currentUrl);
    this.navigateWithoutStack(previous);
  }

  goForward(): void {
    if (this.plugin.isElectronWebview(this.surfaceEl) && this.surfaceEl.canGoForward?.()) {
      this.surfaceNavMode = "forward";
      this.surfaceEl.goForward?.();
      return;
    }
    const next = this.forwardStack.pop();
    if (!next) {
      new Notice("No next page");
      return;
    }
    if (this.currentUrl) this.backStack.push(this.currentUrl);
    this.navigateWithoutStack(next);
  }

  navigateWithoutStack(url: string): void {
    this.flushCurrentWebNoteBeforeRender();
    const query = this.extractBingQuery(url);
    if (this.isBingHome(url) || query !== null) {
      if (query) {
        this.searchBing(query, url);
      } else {
        this.showNativeHome(url);
      }
      return;
    }

    this.currentUrl = url;
    this.currentTitle = hostName(url);
    this.addressEl.value = url;
    this.titleEl.setText(this.currentTitle);
    this.subtitleEl.setText("Reading...");
    this.renderUrlAsNote(url);
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
    const query = this.extractBingQuery(this.currentUrl);
    if (this.isBingHome(this.currentUrl) || query !== null) {
      if (query) {
        this.searchBing(query, this.currentUrl);
      } else {
        this.showNativeHome(this.currentUrl);
      }
      return;
    }
    if (this.plugin.isElectronWebview(this.surfaceEl) && this.surfaceEl.reload) {
      this.surfaceNavMode = "reload";
      this.surfaceEl.reload();
      return;
    }
    this.renderUrlAsNote(this.currentUrl);
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
    this.subtitleEl.setText("Native light home");
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
    this.subtitleEl.setText("Searching Bing...");
    this.setLiveFrameMode(false);
    this.buildHome(cleanQuery, []);
    void this.syncActiveBrowserTab();
    this.renderTabStrip();

    try {
      const results = await this.plugin.searchBing(cleanQuery);
      this.subtitleEl.setText(`${results.length} result(s)`);
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
    }
  }

  setLiveFrameMode(enabled: boolean): void {
    const wrap = this.surfaceEl.parentElement;
    wrap?.toggleClass("is-live-page", enabled);
    wrap?.toggleClass("is-note-front", enabled && this.frontendMode === "note");
    wrap?.toggleClass("is-web-front", enabled && this.frontendMode === "web");
    wrap?.toggleClass("is-split-front", enabled && this.frontendMode === "split");
    this.homeEl.toggleClass("mwv-reader-strip", enabled);
    this.homeEl.addClass("is-visible");
    if (enabled) {
      this.surfaceEl.removeClass("is-hidden");
    } else {
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
    article.createEl("h1", { text: "Reader" });
    article.createEl("p", { text: url });
  }

  renderErrorNote(url: string): void {
    this.flushCurrentWebNoteBeforeRender();
    this.setLiveFrameMode(true);
    this.homeEl.empty();
    const article = this.homeEl.createEl("article", { cls: "mwv-note-surface" });
    article.createDiv({ cls: "mwv-note-source", text: hostName(url) });
    article.createEl("h1", { text: "Page tools" });
    const actions = article.createDiv({ cls: "mwv-note-actions" });
    const copyButton = actions.createEl("button", { text: "Copy link", attr: { type: "button" } });
    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(url);
      new Notice("Copied link");
    });
  }

  renderNotePage(page: NotePage, note?: WebNoteEntry): void {
    this.finishActiveDoodle();
    this.homeEl.empty();
    const article = this.homeEl.createEl("article", { cls: "mwv-note-surface" });
    article.dataset.url = page.url;
    article.createDiv({ cls: "mwv-note-source", text: page.byline || hostName(page.url) });
    article.createEl("h1", { text: page.title || hostName(page.url) });

    const actions = article.createDiv({ cls: "mwv-note-actions" });
    const copyButton = actions.createEl("button", { text: "Copy link", attr: { type: "button" } });
    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(`[${page.title}](${page.url})`);
      new Notice("Copied link");
    });
    const noteWebButton = actions.createEl("button", { text: "Note Web", attr: { type: "button" } });
    noteWebButton.addEventListener("click", async () => {
      await this.saveCurrentWebNote(false, status);
      await this.plugin.openNoteBrowser(page.url);
    });
    const saveButton = actions.createEl("button", { text: "存 MD", attr: { type: "button" } });
    saveButton.addEventListener("click", () => void this.exportCurrentWebNote(status));
    const doodleButton = actions.createEl("button", { text: "涂鸦", attr: { type: "button" } });
    doodleButton.dataset.mwvDoodleToggle = "true";
    doodleButton.setAttribute("aria-pressed", "false");
    doodleButton.addEventListener("click", () => this.toggleDoodleLayer(article, doodleButton));
    const status = actions.createSpan({ cls: "mwv-webnote-status", text: note?.markdownPath ? `已入库 ${note.markdownPath}` : "自动保存到插件" });

    const noteWrap = article.createDiv({ cls: "mwv-webnote-wrap" });
    const content = noteWrap.createDiv({
      cls: "mwv-note-content mwv-webnote-editor",
      attr: {
        contenteditable: "true",
        spellcheck: "true",
        "aria-label": "Editable web note"
      }
    });
    this.populateWebNoteContent(content, page, note);
    const doodleLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    doodleLayer.addClass("mwv-doodle-layer");
    doodleLayer.setAttribute("viewBox", "0 0 1000 1000");
    doodleLayer.setAttribute("preserveAspectRatio", "none");
    doodleLayer.setAttribute("aria-hidden", "true");
    noteWrap.appendChild(doodleLayer);
    if (note?.doodleSvg) {
      doodleLayer.innerHTML = note.doodleSvg;
    }
    this.bindWebNoteEditor(content, status);
    this.bindDoodleLayer(doodleLayer, status);
    this.plugin.applyReaderCustomizations(article, page);

    if (page.links.length) {
      const related = article.createDiv({ cls: "mwv-note-related" });
      related.createEl("h2", { text: "Links" });
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
  }

  populateWebNoteContent(content: HTMLElement, page: NotePage, note?: WebNoteEntry): void {
    if (note?.noteHtml) {
      content.innerHTML = note.noteHtml;
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
      status.setText("保存中...");
      this.queueWebNoteSave(status);
    };
    content.addEventListener("input", markDirty);
    content.addEventListener("paste", markDirty);
    content.addEventListener("blur", () => void this.saveCurrentWebNote(false, status));
  }

  queueWebNoteSave(status?: HTMLElement): void {
    if (!this.plugin.settings.autoSaveWebNotes) return;
    if (this.webNoteSaveTimer) window.clearTimeout(this.webNoteSaveTimer);
    this.webNoteSaveTimer = window.setTimeout(() => {
      void this.saveCurrentWebNote(false, status);
    }, 700);
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
    status?.setText(this.currentWebNote.markdownPath ? `已自动保存，已入库 ${this.currentWebNote.markdownPath}` : "已自动保存到插件");
    if (showNotice) new Notice("Web note saved in plugin data");
    return this.currentWebNote;
  }

  async exportCurrentWebNote(status?: HTMLElement): Promise<void> {
    const saved = await this.saveCurrentWebNote(false, status);
    if (!saved) return;
    const exported = await this.plugin.exportWebNoteMarkdown(saved);
    this.currentWebNote = exported;
    status?.setText(`已入库 ${exported.markdownPath}`);
    new Notice(`Saved to ${exported.markdownPath}`);
  }

  setDoodleToggleState(button: HTMLButtonElement, enabled: boolean): void {
    button.toggleClass("is-active", enabled);
    button.setAttribute("aria-pressed", enabled ? "true" : "false");
    button.setText(enabled ? "关闭涂鸦" : "涂鸦");
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
    void this.saveCurrentWebNote(false, status);
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
      void this.saveCurrentWebNote(false, status ?? undefined);
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
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
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
      status.setText("保存中...");
    });
    const finish = (event: PointerEvent) => {
      if (!this.activeDoodlePath || this.activeDoodlePath.ownerSVGElement !== svg) return;
      this.finishActiveDoodle(event);
      this.queueWebNoteSave(status);
    };
    svg.addEventListener("pointerup", finish);
    svg.addEventListener("pointercancel", finish);
    svg.addEventListener("pointerleave", finish);
    svg.addEventListener("lostpointercapture", (event) => {
      if (!this.activeDoodlePath || this.activeDoodlePath.ownerSVGElement !== svg) return;
      this.finishActiveDoodle(event);
      this.queueWebNoteSave(status);
    });
    this.registerDomEvent(window, "pointerup", (event) => {
      if (!this.activeDoodlePath || this.activeDoodlePath.ownerSVGElement !== svg) return;
      this.finishActiveDoodle(event as PointerEvent);
      this.queueWebNoteSave(status);
    });
    this.registerDomEvent(window, "pointercancel", (event) => {
      if (!this.activeDoodlePath || this.activeDoodlePath.ownerSVGElement !== svg) return;
      this.finishActiveDoodle(event as PointerEvent);
      this.queueWebNoteSave(status);
    });
    this.registerDomEvent(window, "blur", () => {
      if (!this.activeDoodlePath || this.activeDoodlePath.ownerSVGElement !== svg) return;
      this.finishActiveDoodle();
      this.queueWebNoteSave(status);
    });
  }

  async toggleBookmark(): Promise<void> {
    if (!this.currentUrl) return;
    const added = await this.plugin.toggleBookmarkEntry(this.currentUrl, this.currentTitle || hostName(this.currentUrl));
    new Notice(added ? "Bookmark added" : "Bookmark removed");
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
    head.createDiv({ cls: "mwv-more-title", text: "More" });
    const close = head.createEl("button", { cls: "mwv-more-close", attr: { type: "button", "aria-label": "Close More" } });
    setIcon(close, "x");
    close.addEventListener("click", () => this.closeMorePanel());

    const body = panel.createDiv({ cls: "mwv-more-body" });
    const feedback = body.createDiv({
      cls: "mwv-more-feedback",
      text: `下载保存到: ${this.plugin.normalizeDownloadFolder()}`
    });
    const actions = body.createDiv({ cls: "mwv-more-actions" });
    const setFeedback = (message: string, isError = false) => {
      feedback.setText(message);
      feedback.toggleClass("is-error", isError);
    };
    const addAction = (icon: string, label: string, onClick: () => void | Promise<void>): HTMLButtonElement => {
      const button = actions.createEl("button", { cls: "mwv-more-action", attr: { type: "button", title: label } });
      setIcon(button, icon);
      button.createSpan({ text: label });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.disabled = true;
        setFeedback(`正在执行: ${label}`);
        Promise.resolve(onClick())
          .then(() => setFeedback(`已完成: ${label}`))
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            setFeedback(`${label} 失败: ${message}`, true);
            void this.plugin.addConsole("error", `${label} failed: ${message}`, url);
            new Notice(`${label} failed`);
          })
          .finally(() => {
            button.disabled = false;
          });
      });
      return button;
    };

    addAction("download", `下载页 (${this.plugin.settings.downloads.length})`, () => {
      this.closeMorePanel();
      this.openDrawer("downloads");
    });
    addAction("external-link", "用浏览器打开", () => {
      window.open(url, "_blank");
    });
    addAction("file-text", "打开 Note Web", async () => {
      this.closeMorePanel();
      await this.plugin.openNoteBrowser(url);
    });
    addAction("copy", "复制链接", async () => {
      await navigator.clipboard.writeText(`[${title}](${url})`);
      new Notice("Copied link");
    });
    addAction("share-2", "分享", () => this.plugin.sharePage(url, title));
    addAction("plus", "新 OB 标签", () => this.newBrowserTab());
    addAction("search", "页内查找", () => this.toggleFindPanel());
    addAction("activity", "浏览器状态", () => this.toggleMoreBrowserStatusPanel(body, url));
    addAction("wrench", "打开 DevTools", async () => {
      const opened = await this.plugin.openBrowserDevTools(this.surfaceEl);
      if (!opened) throw new Error("当前页面层不支持 DevTools");
    });
    addAction("zoom-in", `放大 ${this.plugin.settings.pageZoom}%`, () => this.plugin.setPageZoom(this.plugin.settings.pageZoom + 10, this.containerEl));
    addAction("zoom-out", "缩小", () => this.plugin.setPageZoom(this.plugin.settings.pageZoom - 10, this.containerEl));
    addAction("monitor-smartphone", this.plugin.settings.desktopMode ? "手机版" : "桌面版", () => this.plugin.toggleDesktopMode(this.containerEl));
    addAction("moon", this.plugin.settings.nightMode ? "日间模式" : "夜间模式", () => this.plugin.toggleBooleanMode("nightMode", this.containerEl, "Night mode"));
    addAction("image-off", this.plugin.settings.noImageMode ? "显示图片" : "无图模式", async () => {
      await this.plugin.toggleBooleanMode("noImageMode", this.containerEl, "No image mode");
      this.reload();
    });
    addAction("eye", this.plugin.settings.eyeProtectionMode ? "关闭护眼" : "护眼模式", () => this.plugin.toggleBooleanMode("eyeProtectionMode", this.containerEl, "Eye mode"));
    addAction("shield-check", this.plugin.settings.adBlockEnabled ? "关闭拦截" : "广告拦截", async () => {
      await this.plugin.toggleBooleanMode("adBlockEnabled", this.containerEl, "Ad block");
      this.reload();
    });
    addAction("glasses", this.plugin.settings.incognitoMode ? "关闭无痕" : "无痕", () => this.plugin.toggleBooleanMode("incognitoMode", this.containerEl, "Incognito"));
    addAction("maximize", this.plugin.settings.fullScreenMode ? "退出全屏" : "全屏", () => this.plugin.toggleFullscreen(this.containerEl));
    addAction("file-x", this.plugin.settings.jsDisabled ? "启用 JS" : "禁用 JS", async () => {
      await this.plugin.toggleBooleanMode("jsDisabled", this.containerEl, "JavaScript");
      this.reload();
    });
    addAction("smartphone", `UA: ${this.plugin.settings.userAgentMode}`, async () => {
      await this.plugin.toggleUserAgent(this.containerEl);
      this.reload();
    });
    addAction("rotate-cw", this.plugin.settings.rotatedMode ? "关闭横屏" : "横屏", () => this.plugin.toggleBooleanMode("rotatedMode", this.containerEl, "Rotate"));
    addAction("type", `字号 ${this.plugin.settings.readerFontScale}%`, () => this.plugin.adjustReaderFont(10, this.containerEl));
    addAction("download", "下载文件", async () => {
      const entry = await this.plugin.downloadUrlFile(url);
      setFeedback(`下载完成: ${entry.path || entry.message}`);
      this.closeMorePanel();
      this.openDrawer("downloads");
    });
    addAction("file-code", "保存 HTML", async () => {
      const entry = await this.plugin.downloadCurrentPageHtml(url, title);
      setFeedback(`已保存: ${entry.path || entry.message}`);
      this.closeMorePanel();
      this.openDrawer("downloads");
    });
    addAction("archive", "保存 MHT", async () => {
      const entry = await this.plugin.downloadCurrentPageMhtml(url, title);
      setFeedback(`已保存: ${entry.path || entry.message}`);
      this.closeMorePanel();
      this.openDrawer("downloads");
    });
    addAction("file-down", "离线页面", async () => {
      await this.plugin.saveOfflinePage(url, title);
      this.closeMorePanel();
      this.openDrawer("downloads");
    });
    addAction("external-link", "桌面快捷方式", async () => {
      const path = await this.plugin.createShortcutFile(url, title);
      setFeedback(`已保存: ${path}`);
      new Notice(`Saved ${path}`);
    });
    addAction("text-cursor-input", "自动填表", () => this.autofillCurrentPage());
    addAction("star", this.plugin.settings.bookmarks.some((entry) => entry.url === url) ? "移除书签" : "添加书签", () => this.toggleBookmark());
    addAction("book-open", "加入稍后读", async () => {
      await this.plugin.addReadingList({ title, url, time: Date.now() });
      this.renderDrawer(this.currentDrawer);
      new Notice("Added to reading list");
    });
    addAction("library", `稍后读 (${this.plugin.settings.readingList.length})`, () => {
      this.closeMorePanel();
      this.openDrawer("reading");
    });
    addAction("terminal", `反馈日志 (${this.plugin.settings.consoleEntries.length})`, () => {
      this.toggleMoreConsolePanel(body, url);
    });
    addAction("wand-sparkles", `脚本 (${this.plugin.getActiveUserScriptRules(url).length})`, () => this.plugin.openSettings());
    addAction("radio", "媒体嗅探", async () => {
      const assets = await this.plugin.extractPageAssets(url);
      await navigator.clipboard.writeText(assets.media.join("\n"));
      new Notice(`Media copied: ${assets.media.length}`);
    });
    addAction("layers", "页面资源", async () => {
      const assets = await this.plugin.extractPageAssets(url);
      await navigator.clipboard.writeText([...assets.links, ...assets.media, ...assets.scripts, ...assets.styles].join("\n"));
      new Notice("Resources copied");
    });
    addAction("code-2", "复制源码", async () => {
      const assets = await this.plugin.extractPageAssets(url);
      await navigator.clipboard.writeText(assets.html);
      new Notice("Source copied");
    });
    addAction("languages", `翻译 (${translateModeLabel(this.plugin.settings.translateTarget)})`, () => {
      new TranslateLanguageModal(this.app, this.plugin, url, (translateUrl) => this.navigate(translateUrl, true)).open();
    });
    addAction("volume-2", "朗读", () => this.plugin.readPageAloud(url));
    addAction("qr-code", "二维码", () => {
      window.open(`https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(url)}`, "_blank");
    });
    addAction("shield-alert", "复制报告", async () => {
      await navigator.clipboard.writeText(`Report URL\n${url}`);
      new Notice("Report copied");
    });
    addAction("copy", "复制日志", async () => {
      await navigator.clipboard.writeText(this.plugin.formatConsoleEntries());
      new Notice("Console copied");
    });
    addAction("trash", `清缓存 (${this.plugin.settings.pageCache.length})`, async () => {
      await this.plugin.clearCache();
      new Notice("Cache cleared");
    });
    addAction("settings", "设置", () => this.plugin.openSettings());
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
      attr: { type: "search", placeholder: "Find in page", autocomplete: "off" }
    });
    const prev = panel.createEl("button", { cls: "mwv-find-button", attr: { type: "button", title: "Previous" } });
    setIcon(prev, "chevron-up");
    const next = panel.createEl("button", { cls: "mwv-find-button", attr: { type: "button", title: "Next" } });
    setIcon(next, "chevron-down");
    const close = panel.createEl("button", { cls: "mwv-find-button", attr: { type: "button", title: "Close" } });
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
        new Notice("Inserted link");
        return;
      }
    }

    await navigator.clipboard.writeText(markdown);
    new Notice("Copied Markdown link");
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
  settings: MobileWebviewerSettings = DEFAULT_SETTINGS;
  processorSeq = 0;
  noteDrawDedupeTimers = new WeakMap<HTMLElement, number>();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new MobileWebviewerView(leaf, this));
    this.registerMarkdownPostProcessor((el) => {
      this.processWebviewerEmbeds(el);
    });
    this.registerDomEvent(document, "click", (event) => {
      void this.handleGlobalBingEvent(event);
    }, { capture: true });
    this.registerDomEvent(document, "keydown", (event) => {
      void this.handleGlobalBingEvent(event);
    }, { capture: true });
    this.installNoteDrawDedupeObserver();

    this.addRibbonIcon("smartphone", "Mobile Webviewer", () => {
      void this.openNoteBrowser();
    });

    this.addCommand({
      id: "open-note-browser",
      name: "Open Note Browser",
      callback: () => void this.openNoteBrowser()
    });

    this.addCommand({
      id: "open-browser-view",
      name: "Open Browser View",
      callback: () => void this.activateBrowserView()
    });

    this.addCommand({
      id: "open-url-in-mobile-webviewer",
      name: "Open URL in Note Browser",
      callback: async () => {
        const selected = this.app.workspace.activeEditor?.editor?.getSelection() ?? "";
        await this.openNoteBrowser(selected || this.settings.homeUrl);
      }
    });

    this.addCommand({
      id: "open-url-in-browser-view",
      name: "Open URL in Browser View",
      callback: async () => {
        const selected = this.app.workspace.activeEditor?.editor?.getSelection() ?? "";
        await this.activateBrowserView(selected || this.settings.homeUrl);
      }
    });

    this.addCommand({
      id: "open-home-in-mobile-webviewer",
      name: "Open Note Browser Home",
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
            .setTitle("Open links in Mobile Webviewer")
            .setIcon("smartphone")
            .onClick(() => void this.openFirstLinkInFile(file));
        });
      })
    );

    this.addSettingTab(new MobileWebviewerSettingTab(this.app, this));

    // Keep the note browser enhanced after Markdown renders and Live Preview updates.
    this.app.workspace.onLayoutReady(() => {
      this.processWebviewerEmbeds(this.app.workspace.containerEl);
      this.queueNoteDrawButtonDedupe(this.app.workspace.containerEl);
    });
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  installNoteDrawDedupeObserver(): void {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (!(node instanceof HTMLElement)) continue;
          if (!node.matches(NOTEDRAW_BUTTON_SELECTOR) && !node.querySelector(NOTEDRAW_BUTTON_SELECTOR)) continue;
          const root =
            node.closest<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR) ??
            (mutation.target instanceof HTMLElement ? mutation.target.closest<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR) : null) ??
            this.app.workspace.containerEl;
          this.queueNoteDrawButtonDedupe(root);
          return;
        }
      }
    });
    observer.observe(this.app.workspace.containerEl, { childList: true, subtree: true });
    this.register(() => observer.disconnect());
  }

  queueNoteDrawButtonDedupe(root: HTMLElement): void {
    if (!root.isConnected) return;
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

  dedupeNoteDrawButtons(root: HTMLElement): void {
    const baseSurfaces = root.matches(MWV_DEDUPE_ROOT_SELECTOR)
      ? [root, ...Array.from(root.querySelectorAll<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR))]
      : Array.from(root.querySelectorAll<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR));
    const surfaces = new Set<HTMLElement>(baseSurfaces);
    for (const surface of baseSurfaces) {
      const leaf = surface.closest<HTMLElement>(".workspace-leaf-content");
      if (leaf?.querySelector(".mwv-root, .mwv-note-embed, .mwv-embed")) {
        surfaces.add(leaf);
      }
    }
    for (const surface of surfaces) {
      const buttons = Array.from(surface.querySelectorAll<HTMLElement>(NOTEDRAW_BUTTON_SELECTOR)).filter(
        (button) => !button.hasClass("mwv-notedraw-launcher")
      );
      for (const button of buttons) {
        button.addClass("mwv-notedraw-source-button");
        button.setAttribute("aria-hidden", "true");
      }
    }
  }

  findNoteDrawSourceButton(root?: HTMLElement): HTMLElement | null {
    const scopes: HTMLElement[] = [];
    if (root) {
      scopes.push(root);
      const leaf = root.closest<HTMLElement>(".workspace-leaf-content");
      if (leaf) scopes.push(leaf);
    }
    scopes.push(this.app.workspace.containerEl);

    for (const scope of scopes) {
      const buttons = Array.from(scope.querySelectorAll<HTMLElement>(NOTEDRAW_BUTTON_SELECTOR)).filter(
        (candidate) => candidate.isConnected && !candidate.hasClass("mwv-notedraw-launcher")
      );
      const direct = buttons.find((candidate) => candidate.closest(".mwv-root, .mwv-note-embed, .mwv-embed") === root);
      const webview = buttons.find((candidate) => candidate.hasClass("notedraw-webview-button"));
      const header = buttons.find((candidate) => candidate.hasClass("notedraw-header-button"));
      const fallback = buttons[0];
      const picked = direct ?? webview ?? header ?? fallback;
      if (picked) return picked;
    }
    return null;
  }

  collectNoteDrawControllers(root?: HTMLElement): NoteDrawControllerLike[] {
    const scopes: HTMLElement[] = [];
    if (root) {
      scopes.push(root);
      const leaf = root.closest<HTMLElement>(".workspace-leaf-content");
      if (leaf) scopes.push(leaf);
    }
    scopes.push(this.app.workspace.containerEl);

    const controllers: NoteDrawControllerLike[] = [];
    const seen = new Set<NoteDrawControllerLike>();
    const add = (controller?: NoteDrawControllerLike | null) => {
      if (!controller || seen.has(controller)) return;
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
    return controllers;
  }

  isNoteDrawControllerActive(controller?: NoteDrawControllerLike | null): boolean {
    if (!controller) return false;
    return Boolean(
      controller.active ||
      controller.previewEl?.hasClass("is-drawing-active") ||
      controller.previewEl?.querySelector?.(".is-drawing-active")
    );
  }

  findActiveNoteDrawController(root?: HTMLElement): NoteDrawControllerLike | null {
    return this.collectNoteDrawControllers(root).find((controller) => this.isNoteDrawControllerActive(controller)) ?? null;
  }

  findActiveNoteDrawShell(root?: HTMLElement): NoteDrawSurfaceElement | null {
    const scopes: HTMLElement[] = [];
    if (root) {
      scopes.push(root);
      const shell = root.closest<HTMLElement>(".notedraw-shell");
      if (shell) scopes.push(shell);
      const leaf = root.closest<HTMLElement>(".workspace-leaf-content");
      if (leaf) scopes.push(leaf);
    }
    scopes.push(this.app.workspace.containerEl);

    for (const scope of scopes) {
      if (scope.isConnected && scope.matches(".notedraw-shell.is-drawing-active")) {
        return scope as NoteDrawSurfaceElement;
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

  dispatchActivationClick(target: HTMLElement): void {
    target.removeAttribute("aria-hidden");
    target.removeClass("mwv-notedraw-source-button");
    const previousStyle = target.getAttribute("style");
    target.style.setProperty("display", "inline-flex", "important");
    target.style.setProperty("visibility", "visible", "important");
    target.style.setProperty("opacity", "0.001", "important");
    target.style.setProperty("pointer-events", "auto", "important");
    target.style.setProperty("position", "fixed", "important");
    target.style.setProperty("right", "8px", "important");
    target.style.setProperty("bottom", "8px", "important");
    target.style.setProperty("width", "32px", "important");
    target.style.setProperty("height", "32px", "important");
    target.style.setProperty("z-index", "2147483647", "important");
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
      if (previousStyle === null) {
        target.removeAttribute("style");
      } else {
        target.setAttribute("style", previousStyle);
      }
      if (target.isConnected && !target.hasClass("mwv-notedraw-launcher")) {
        target.addClass("mwv-notedraw-source-button");
        target.setAttribute("aria-hidden", "true");
      }
    }, 500);
  }

  triggerNoteDraw(root?: HTMLElement): void {
    const pluginRegistry = (this.app as App & {
      plugins?: { plugins?: Record<string, unknown> };
      commands?: {
        commands?: Record<string, { id?: string; name?: string }>;
        executeCommandById?: (id: string) => boolean;
      };
    });
    if (!pluginRegistry.plugins?.plugins?.notedraw) {
      new Notice("NoteDraw plugin is not enabled.");
      return;
    }

    root?.focus?.({ preventScroll: true });
    window.setTimeout(() => {
      const queueDedupe = () => {
        window.setTimeout(() => this.queueNoteDrawButtonDedupe(root ?? this.app.workspace.containerEl), 120);
        window.setTimeout(() => this.queueNoteDrawButtonDedupe(root ?? this.app.workspace.containerEl), 500);
      };
      const toggleController = (controller?: NoteDrawControllerLike | null): boolean => {
        if (typeof controller?.toggle !== "function") return false;
        try {
          void Promise.resolve(controller.toggle()).catch((error) => {
            console.error("[mobile-webviewer] NoteDraw controller toggle failed", error);
          });
          queueDedupe();
          return true;
        } catch (error) {
          console.error("[mobile-webviewer] NoteDraw controller toggle failed", error);
          return false;
        }
      };
      const clickController = (controller?: NoteDrawControllerLike | null): boolean => {
        if (typeof controller?.onButtonClick !== "function") return false;
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
          });
          queueDedupe();
          return true;
        } catch (error) {
          console.error("[mobile-webviewer] NoteDraw controller click failed", error);
          return false;
        }
      };
      if (this.forceCloseNoteDraw(root, queueDedupe)) {
        return;
      }
      const activeController = this.findActiveNoteDrawController(root);
      if (activeController && toggleController(activeController)) {
        return;
      }
      const button = this.findNoteDrawSourceButton(root) as NoteDrawButtonElement | null;
      if (toggleController(button?._noteDrawController)) {
        return;
      }
      if (clickController(button?._noteDrawController)) {
        return;
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
        queueDedupe();
        return;
      }

      const commands = pluginRegistry.commands;
      const availableIds = Object.keys(commands?.commands ?? {}).filter((id) => id.startsWith("notedraw:"));
      const commandId =
        availableIds.find((id) => id === "notedraw:toggle-draw-mode") ??
        availableIds.find((id) => /toggle|draw/i.test(id)) ??
        "notedraw:toggle-draw-mode";
      if (commands?.executeCommandById?.(commandId)) {
        queueDedupe();
        return;
      }

      void this.addConsole("warn", "NoteDraw controller not ready on this page", root?.dataset?.url ?? "");
    }, 80);
  }

  async activateBrowserView(url?: string, newTab = false, tabId?: string): Promise<void> {
    let leaf = newTab ? undefined : this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(newTab ? "tab" : false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (url && view instanceof MobileWebviewerView) {
      if (tabId) view.activeBrowserTabId = tabId;
      view.openUrl(url);
    }
  }

  async openNoteBrowser(input?: string): Promise<void> {
    if (input) {
      this.settings.noteBrowserUrl = normalizeInput(input, this.settings.searchUrl);
      this.settings.noteBrowserBack = [];
      this.settings.noteBrowserForward = [];
      await this.saveSettings();
    }
    const file = await this.ensureWebviewerNote();
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
  }

  async ensureWebviewerNote(): Promise<TFile> {
    const content = [
      "# Mobile Webviewer",
      "",
      `<div class="mwv-embed mwv-bing-home" data-url="${this.escapeAttr(this.settings.homeUrl)}">`,
      "  <div class=\"mwv-bing-logo\">Bing</div>",
      "  <div class=\"mwv-bing-search\" role=\"search\">",
      "    <input class=\"mwv-bing-input\" type=\"search\" placeholder=\"搜索 Bing\" autocomplete=\"off\" />",
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

  escapeAttr(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  processWebviewerEmbeds(root: HTMLElement): void {
    const embeds = Array.from(root.querySelectorAll<HTMLElement>(".mwv-embed[data-url]"));
    for (const embed of embeds) {
      if (embed.dataset.mwvProcessed) continue;
      embed.dataset.mwvProcessed = String(++this.processorSeq);
      embed.dataset.mwvBack = JSON.stringify(this.settings.noteBrowserBack ?? []);
      embed.dataset.mwvForward = JSON.stringify(this.settings.noteBrowserForward ?? []);
      const url = this.settings.noteBrowserUrl || embed.dataset.url || this.settings.homeUrl;
      embed.dataset.url = url;
      void this.renderEmbed(embed, url);
    }
  }

  async handleGlobalBingEvent(event: Event): Promise<void> {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const embed = target.closest<HTMLElement>(".mwv-embed.mwv-bing-home, .mwv-embed.mwv-note-embed");
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
      new Notice("Copied link");
      return;
    }

    const openTarget =
      event.type === "click"
        ? target.closest<HTMLElement>("[data-mwv-open-url], .mwv-bing-shortcuts a[href]")
        : null;

    if (embed && openTarget) {
      const url =
        openTarget.dataset.mwvOpenUrl ??
        (openTarget instanceof HTMLAnchorElement ? openTarget.href : "");
      if (!url) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      await this.openUrlInEmbed(embed, url);
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
    resultHost.createDiv({ cls: "mwv-bing-status", text: "Searching..." });

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
    const side = shell.createDiv({ cls: "mwv-bing-side" });

    for (const result of results) {
      this.renderSearchResult(main, result);
    }

    if (query.trim() && results.length < 80) {
      const more = main.createEl("button", {
        cls: "mwv-more-results",
        text: "更多结果",
        attr: { type: "button" }
      });
      more.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        more.disabled = true;
        more.setText("加载中...");
        const nextMax = Math.min(80, Math.max(results.length + BING_DEFAULT_MAX_RESULTS, BING_DEFAULT_MAX_RESULTS * 2));
        const nextPages = Math.ceil(nextMax / BING_RESULTS_PER_PAGE);
        try {
          const expanded = await this.searchBing(query, nextPages, nextMax);
          this.renderBingResults(resultHost, query, expanded);
        } catch (error) {
          console.error("[mobile-webviewer] Bing more results failed", error);
          more.disabled = false;
          more.setText("加载失败，重试");
        }
      });
    }

    side.createEl("h3", { text: `深入了解 ${query}` });
    for (const item of relatedSearches(query)) {
      const url = DEFAULT_SEARCH.replace("{{query}}", encodeURIComponent(item));
      const pill = side.createEl("button", {
        cls: "mwv-related-pill",
        attr: { type: "button", "data-mwv-open-url": url, title: url }
      });
      const icon = pill.createSpan({ cls: "mwv-related-icon" });
      setIcon(icon, "search");
      pill.createSpan({ text: item });
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
    titleLine.createEl("a", {
      cls: "mwv-bing-result-title",
      text: result.title,
      href: result.url,
      attr: { "data-mwv-open-url": result.url, title: result.url }
    });
    item.createDiv({ cls: "mwv-bing-result-url", text: result.url });
    const body = item.createDiv({ cls: "mwv-result-body" });
    if (result.imageUrl) {
      body.createEl("img", { cls: "mwv-result-thumb", attr: { src: result.imageUrl, alt: "" } });
    }
    if (result.snippet) body.createDiv({ cls: "mwv-bing-result-snippet", text: result.snippet });
  }

  getEmbedStack(embed: HTMLElement, key: "mwvBack" | "mwvForward"): string[] {
    try {
      const value = embed.dataset[key];
      const parsed = value ? JSON.parse(value) : [];
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
    } catch {
      return [];
    }
  }

  setEmbedStack(embed: HTMLElement, key: "mwvBack" | "mwvForward", stack: string[]): void {
    embed.dataset[key] = JSON.stringify(stack.slice(-40));
  }

  pushEmbedHistory(embed: HTMLElement, nextUrl: string): void {
    const currentUrl = embed.dataset.url;
    if (currentUrl && currentUrl !== nextUrl) {
      const back = this.getEmbedStack(embed, "mwvBack");
      if (back[back.length - 1] !== currentUrl) back.push(currentUrl);
      this.setEmbedStack(embed, "mwvBack", back);
      this.setEmbedStack(embed, "mwvForward", []);
    }
    embed.dataset.url = nextUrl;
    embed.dataset.mwvProgrammaticUrl = nextUrl;
    void this.persistEmbedState(embed);
  }

  async openUrlInEmbed(embed: HTMLElement, url: string, recordHistory = true): Promise<void> {
    const nextUrl = normalizeInput(url, this.settings.searchUrl);
    this.flushEmbedReader(embed);
    if (recordHistory) {
      this.pushEmbedHistory(embed, nextUrl);
    } else {
      embed.dataset.url = nextUrl;
      embed.dataset.mwvProgrammaticUrl = nextUrl;
      void this.persistEmbedState(embed);
    }
    const query = this.extractBingQuery(nextUrl);
    if (this.isBingHome(nextUrl) || query !== null) {
      this.renderBingShellEmbed(embed, query ?? "");
      void this.addHistory({
        title: query ? `Bing: ${query}` : "Bing",
        url: nextUrl,
        time: Date.now()
      });
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

  async navigateEmbedBack(embed: HTMLElement): Promise<void> {
    const surface = embed.querySelector<BrowserSurfaceElement>(".mwv-live-frame");
    if (this.isElectronWebview(surface) && surface.canGoBack?.()) {
      surface.goBack?.();
      return;
    }
    const back = this.getEmbedStack(embed, "mwvBack");
    const previous = back.pop();
    if (!previous) return;
    const current = embed.dataset.url;
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
    const surface = embed.querySelector<BrowserSurfaceElement>(".mwv-live-frame");
    if (this.isElectronWebview(surface) && surface.canGoForward?.()) {
      surface.goForward?.();
      return;
    }
    const forward = this.getEmbedStack(embed, "mwvForward");
    const next = forward.pop();
    if (!next) return;
    const current = embed.dataset.url;
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
    const surface = embed.querySelector<BrowserSurfaceElement>(".mwv-live-frame");
    if (this.isElectronWebview(surface) && surface.reload) {
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

  flushEmbedReader(embed: HTMLElement): void {
    const panels = Array.from(embed.querySelectorAll<WebNotePanelElement>(".mwv-reader-panel"));
    for (const panel of panels) {
      try {
        void Promise.resolve(panel._mwvFlushWebNote?.()).catch((error) => {
          console.error("[mobile-webviewer] reader flush failed", error);
        });
      } catch (error) {
        console.error("[mobile-webviewer] reader flush failed", error);
      }
      panel.removeClass("is-doodling");
      panel.querySelectorAll<HTMLButtonElement>("[data-mwv-doodle-toggle]").forEach((button) => {
        button.removeClass("is-active");
        button.setAttribute("aria-pressed", "false");
        button.setText("涂鸦");
      });
    }
  }

  async renderEmbed(embed: HTMLElement, url: string): Promise<void> {
    const query = this.extractBingQuery(url);
    if (this.isBingHome(url) || query !== null) {
      this.renderBingShellEmbed(embed, query ?? "");
      return;
    }

    embed.empty();
    embed.addClass("mwv-embed");
    embed.addClass("mwv-note-embed");
    embed.dataset.url = url;
    embed.removeClass("mwv-bing-home");
    this.renderBrowserChrome(embed, url, "Loading");

    if (this.settings.liveBrowserFirst) {
      const reader = embed.createDiv({ cls: "mwv-reader-panel is-loading mwv-note-front-panel" });
      reader.createDiv({ cls: "mwv-reader-panel-title", text: "Reader" });
      reader.createDiv({ cls: "mwv-reader-loading-text", text: "正在提取页面摘要..." });
      this.renderLiveBrowserSurface(embed, url);
      try {
        const page = await this.fetchNotePage(url);
        const note = await this.ensureWebNote(page);
        this.renderReaderPanel(reader, page, note, embed);
      } catch (error) {
        console.error("[mobile-webviewer] reader extraction failed", error);
        void this.addConsole("warn", "Reader extraction skipped", url);
        reader.remove();
      }
      return;
    }

    try {
      const page = await this.fetchNotePage(url);
      this.renderPageEmbed(embed, page);
    } catch (error) {
      console.error("[mobile-webviewer] reader-first extraction failed", error);
      void this.addConsole("warn", "Reader-first extraction skipped", url);
      embed.empty();
      embed.addClass("mwv-embed");
      embed.addClass("mwv-note-embed");
      embed.dataset.url = url;
      embed.removeClass("mwv-bing-home");
      this.renderBrowserChrome(embed, url, hostName(url));
      this.renderLiveBrowserSurface(embed, url);
    }
  }

  renderEmbedFallback(embed: HTMLElement, url: string, title: string): void {
    embed.empty();
    embed.addClass("mwv-embed");
    embed.addClass("mwv-note-embed");
    embed.removeClass("mwv-bing-home");
    embed.dataset.url = url;
    embed.dataset.mwvProgrammaticUrl = url;
    this.renderBrowserChrome(embed, url, title || hostName(url));
    this.renderLiveBrowserSurface(embed, url);
    this.updateEmbedStatus(embed, url, hostName(url));
  }

  renderLiveBrowserSurface(embed: HTMLElement, url: string): void {
    this.applyBrowserRuntimeClasses(embed);
    const surface = embed.createDiv({ cls: "mwv-live-browser" });
    const frame = this.createBrowserSurface(surface, url, "mwv-live-frame", hostName(url), {
      onReady: () => this.applyAccessibleFrameFilters(frame, embed.dataset.url || url),
      onNavigate: (nextUrl) => this.handleEmbedSurfaceNavigate(embed, nextUrl),
      onTitle: (title) => this.handleEmbedSurfaceTitle(embed, title),
      onFail: (message, failedUrl) => {
        const currentUrl = failedUrl ?? embed.dataset.url ?? url;
        this.updateEmbedStatus(embed, currentUrl, hostName(currentUrl));
        void this.addConsole("warn", `Note Browser load issue: ${message}`, currentUrl);
      },
      onConsole: (level, message, pageUrl) => this.addConsole(level, message, pageUrl ?? embed.dataset.url ?? url),
      onNewWindow: (nextUrl) => this.activateBrowserView(nextUrl, true),
      onLoading: (loading, loadingUrl) => this.updateEmbedLoading(embed, loading, loadingUrl || url),
      onFavicon: (iconUrl) => this.addConsole("info", `Favicon: ${iconUrl}`, embed.dataset.url || url),
      onDownloadCandidate: (downloadUrl) => this.handleEmbedDownloadCandidate(embed, downloadUrl),
      onContextLink: (linkUrl, linkTitle) => this.updateEmbedStatus(embed, linkUrl, linkTitle)
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
    new Notice(`Download complete: ${entry.path || entry.message}`);
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
    } catch (error) {
      console.error("[mobile-webviewer] reader sync failed", error);
      reader.removeClass("is-loading");
      void this.addConsole("warn", "Reader sync skipped", url);
    }
  }

  handleEmbedSurfaceNavigate(embed: HTMLElement, url: string): void {
    if (!url || url === "about:blank" || url.startsWith("devtools://")) return;
    const nextUrl = normalizeInput(url, this.settings.searchUrl);
    const previous = embed.dataset.url;
    const programmaticUrl = embed.dataset.mwvProgrammaticUrl;
    if (previous && previous !== nextUrl) {
      this.flushEmbedReader(embed);
    }
    if (programmaticUrl === nextUrl) {
      delete embed.dataset.mwvProgrammaticUrl;
    } else if (previous && previous !== nextUrl) {
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
    void this.persistEmbedState(embed);
    void this.addHistory({
      title: this.getEmbedSurfaceTitle(embed) || hostName(nextUrl),
      url: nextUrl,
      time: Date.now()
    });
    window.setTimeout(() => void this.syncEmbedReaderFromUrl(embed, nextUrl), 600);
  }

  handleEmbedSurfaceTitle(embed: HTMLElement, title: string): void {
    const url = embed.dataset.url || this.settings.homeUrl;
    this.updateEmbedChrome(embed, url, title || hostName(url));
  }

  getEmbedSurfaceTitle(embed: HTMLElement): string {
    const surface = embed.querySelector<BrowserSurfaceElement>(".mwv-live-frame");
    return surface ? this.getBrowserSurfaceTitle(surface) : "";
  }

  updateEmbedChrome(embed: HTMLElement, url: string, title: string): void {
    const address = embed.querySelector<HTMLInputElement>(".mwv-browser-url");
    if (address) address.value = url;
    const form = embed.querySelector<HTMLElement>(".mwv-browser-address");
    if (form) form.setAttribute("title", url);
    const lock = embed.querySelector<HTMLElement>(".mwv-browser-lock");
    if (lock) lock.setText(/^https:\/\//i.test(url) ? "https" : "page");
    const titleEl = embed.querySelector<HTMLElement>(".mwv-browser-page-title");
    if (titleEl) titleEl.setText(title || hostName(url));
    const status = embed.querySelector<HTMLElement>(".mwv-browser-status-text");
    if (status) status.setText(hostName(url));
    const more = embed.querySelector<HTMLElement>(".mwv-browser-action");
    if (more) {
      more.dataset.mwvUrl = url;
      more.dataset.mwvTitle = title;
    }
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
    } catch (error) {
      console.error("[mobile-webviewer] reader flush before rerender failed", error);
    }
    delete statePanel._mwvFinishDoodle;
    delete statePanel._mwvFlushWebNote;
    panel.empty();
    panel.removeClass("is-loading");
    panel.createDiv({ cls: "mwv-reader-panel-title", text: "Reader" });
    panel.createDiv({ cls: "mwv-note-source", text: page.byline || hostName(page.url) });
    panel.createEl("h2", { cls: "mwv-page-title", text: page.title || hostName(page.url) });
    const actions = panel.createDiv({ cls: "mwv-note-actions" });
    const browserBtn = actions.createEl("button", { text: "Browser View", attr: { type: "button" } });
    const saveBtn = actions.createEl("button", { text: "存 MD", attr: { type: "button" } });
    const doodleBtn = actions.createEl("button", { text: "涂鸦", attr: { type: "button" } });
    doodleBtn.dataset.mwvDoodleToggle = "true";
    doodleBtn.setAttribute("aria-pressed", "false");
    const status = actions.createSpan({ cls: "mwv-webnote-status", text: note?.markdownPath ? `已入库 ${note.markdownPath}` : "自动保存到插件" });
    if (page.images.length) {
      const media = panel.createDiv({ cls: "mwv-page-media" });
      for (const image of page.images.slice(0, 4)) {
        media.createEl("img", { attr: { src: image, alt: "" } });
      }
    }
    const noteWrap = panel.createDiv({ cls: "mwv-webnote-wrap" });
    const content = noteWrap.createDiv({
      cls: "mwv-md-content mwv-webnote-editor",
      attr: { contenteditable: "true", spellcheck: "true" }
    });
    if (note?.noteHtml) {
      content.innerHTML = note.noteHtml;
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
    const doodleLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    doodleLayer.addClass("mwv-doodle-layer");
    doodleLayer.setAttribute("viewBox", "0 0 1000 1000");
    doodleLayer.setAttribute("preserveAspectRatio", "none");
    doodleLayer.setAttribute("aria-hidden", "true");
    if (note?.doodleSvg) {
      doodleLayer.innerHTML = note.doodleSvg;
    }
    noteWrap.appendChild(doodleLayer);
    let currentNote = note;
    let activePath: SVGPathElement | undefined;
    let activePointerId: number | undefined;
    const save = async () => {
      const base = currentNote ?? this.createWebNoteFromPage(page);
      const saved = await this.saveWebNote({
        ...base,
        noteHtml: content.innerHTML,
        noteText: htmlToMarkdownFromElement(content),
        doodleSvg: doodleLayer.innerHTML,
        updatedAt: Date.now()
      });
      currentNote = saved;
      status.setText(saved.markdownPath ? `已自动保存，已入库 ${saved.markdownPath}` : "已自动保存到插件");
      return saved;
    };
    let timer: number | undefined;
    const queue = () => {
      if (!this.settings.autoSaveWebNotes) return;
      status.setText("保存中...");
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void save(), 700);
    };
    content.addEventListener("input", queue);
    content.addEventListener("blur", () => void save());
    browserBtn.addEventListener("click", async () => {
      await save();
      await this.activateBrowserView(page.url);
    });
    saveBtn.addEventListener("click", () => {
      void (async () => {
        const saved = await save();
        const exported = await this.exportWebNoteMarkdown(saved);
        currentNote = exported;
        status.setText(`已入库 ${exported.markdownPath}`);
        new Notice(`Saved to ${exported.markdownPath}`);
      })();
    });
    const setDoodleToggle = (enabled: boolean) => {
      panel.toggleClass("is-doodling", enabled);
      doodleBtn.toggleClass("is-active", enabled);
      doodleBtn.setAttribute("aria-pressed", enabled ? "true" : "false");
      doodleBtn.setText(enabled ? "关闭涂鸦" : "涂鸦");
    };
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
      if (shouldQueue) queue();
    };
    statePanel._mwvFinishDoodle = () => finishDoodle(undefined, false);
    statePanel._mwvFlushWebNote = async () => {
      finishDoodle(undefined, false);
      setDoodleToggle(false);
      await save();
    };
    doodleBtn.addEventListener("click", () => {
      const enabled = !panel.hasClass("is-doodling");
      finishDoodle(undefined, false);
      setDoodleToggle(enabled);
      if (!enabled) void save();
    });
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
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
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
      status.setText("保存中...");
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
    this.applyReaderCustomizations(panel, page);
  }

  renderBingShellEmbed(embed: HTMLElement, query = ""): void {
    this.flushEmbedReader(embed);
    embed.empty();
    embed.addClass("mwv-bing-home");
    embed.removeClass("mwv-note-embed");

    const currentUrl = query
      ? DEFAULT_SEARCH.replace("{{query}}", encodeURIComponent(query))
      : this.settings.homeUrl;
    embed.addClass("mwv-embed");
    embed.dataset.url = currentUrl;
    this.renderBrowserChrome(embed, currentUrl, query ? `Bing: ${query}` : "Bing");

    const searchHeader = query.trim()
      ? embed.createDiv({ cls: "mwv-bing-serp-head" })
      : embed;

    if (query.trim()) {
      const brand = searchHeader.createDiv({ cls: "mwv-bing-mini-brand" });
      brand.createSpan({ cls: "mwv-ms-dot mwv-ms-red" });
      brand.createSpan({ cls: "mwv-ms-dot mwv-ms-green" });
      brand.createSpan({ cls: "mwv-ms-dot mwv-ms-blue" });
      brand.createSpan({ cls: "mwv-ms-dot mwv-ms-yellow" });
    } else {
      embed.createDiv({ cls: "mwv-bing-logo", text: "Bing" });
    }

    const search = searchHeader.createDiv({ cls: "mwv-bing-search", attr: { role: "search" } });
    const input = search.createEl("input", {
      cls: "mwv-bing-input",
      value: query,
      attr: {
        type: "search",
        placeholder: "搜索 Bing",
        autocomplete: "off"
      }
    });
    const submit = search.createEl("button", {
      cls: "mwv-bing-submit",
      text: "→",
      attr: { type: "button" }
    });

    if (query.trim()) {
      const tabs = embed.createDiv({ cls: "mwv-bing-tabs" });
      for (const item of [
        ["网页", DEFAULT_SEARCH.replace("{{query}}", encodeURIComponent(query))],
        ["图片", `https://www.bing.com/images/search?q=${encodeURIComponent(query)}`],
        ["视频", `https://www.bing.com/videos/search?q=${encodeURIComponent(query)}`],
        ["学术", `https://www.bing.com/search?q=${encodeURIComponent(`${query} 学术`)}`],
        ["词典", `https://www.bing.com/search?q=${encodeURIComponent(`${query} 词典`)}`],
        ["地图", `https://www.bing.com/maps?q=${encodeURIComponent(query)}`],
        ["更多", DEFAULT_SEARCH.replace("{{query}}", encodeURIComponent(`${query} more`))]
      ]) {
        const tab = tabs.createEl("button", {
          cls: item[0] === "网页" ? "mwv-bing-tab is-active" : "mwv-bing-tab",
          attr: { type: "button", "data-mwv-open-url": item[1] }
        });
        tab.createSpan({ text: item[0] });
      }
    }

    const resultHost = embed.createDiv({ cls: "mwv-bing-results" });
    const runSearch = async (event?: Event) => {
      event?.preventDefault();
      event?.stopPropagation();
      await this.runBingHomeSearch(embed, input, resultHost);
    };

    submit.addEventListener("click", runSearch, true);
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

    form.addEventListener("submit", runSearch, true);
    submit?.addEventListener("click", runSearch, true);
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
      attr: { type: "search", placeholder: "Search Bing" }
    });
    const button = form.createEl("button", { text: "Search", attr: { type: "submit" } });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const next = DEFAULT_SEARCH.replace("{{query}}", encodeURIComponent(input.value.trim()));
      await this.openUrlInEmbed(embed, next);
    });
    if (button) {
      button.addClass("mwv-md-button");
    }
    if (query) {
      const list = embed.createDiv({ cls: "mwv-md-results" });
      list.createEl("p", { text: "Searching..." });
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
    const chrome = embed.createDiv({ cls: "mwv-browser-chrome" });
    const controls = chrome.createDiv({ cls: "mwv-browser-controls" });
    const setMode = (mode: "note" | "web" | "split") => {
      embed.dataset.mwvBrowserMode = mode;
      embed.toggleClass("is-web-front", mode === "web");
      embed.toggleClass("is-split-front", mode === "split");
      embed.querySelectorAll<HTMLElement>("[data-mwv-embed-mode]").forEach((button) => {
        button.toggleClass("is-active", button.dataset.mwvEmbedMode === mode);
      });
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
      const button = controls.createEl("button", {
        cls: "mwv-browser-nav mwv-browser-mode",
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

    makeNavButton("arrow-left", "Back", () => void this.navigateEmbedBack(embed), this.getEmbedStack(embed, "mwvBack").length === 0);
    makeNavButton("arrow-right", "Forward", () => void this.navigateEmbedForward(embed), this.getEmbedStack(embed, "mwvForward").length === 0);
    makeNavButton("rotate-cw", "Reload", () => void this.refreshEmbed(embed));
    makeNavButton("home", "Home", () => void this.openUrlInEmbed(embed, this.settings.homeUrl));
    makeModeButton("file-text", "笔记", "note");
    makeModeButton("globe-2", "网页", "web");
    makeModeButton("panel-top", "分屏", "split");

    const suggestionsId = `mwv-url-suggestions-${++this.processorSeq}`;
    const address = chrome.createEl("form", {
      cls: "mwv-browser-address",
      attr: { title: url }
    });
    address.createSpan({ cls: "mwv-browser-lock", text: /^https:\/\//i.test(url) ? "https" : "page" });
    const addressInput = address.createEl("input", {
      cls: "mwv-browser-url",
      value: url,
      attr: {
        type: "text",
        inputmode: "url",
        autocomplete: "off",
        autocapitalize: "off",
        spellcheck: "false",
        list: suggestionsId,
        "aria-label": "Address"
      }
    });
    this.renderUrlSuggestions(address, suggestionsId);
    const go = address.createEl("button", {
      cls: "mwv-browser-go",
      attr: { type: "submit", title: "Go", "aria-label": "Go" }
    });
    setIcon(go, "arrow-right");
    address.addEventListener("submit", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.openUrlInEmbed(embed, addressInput.value);
    });

    const actions = chrome.createDiv({ cls: "mwv-browser-actions" });
    if (this.settings.showFloatingWand) {
      const wand = actions.createEl("button", {
        cls: "mwv-browser-action mwv-notedraw-launcher",
        attr: { type: "button", title: "NoteDraw", "aria-label": "NoteDraw" }
      });
      setIcon(wand, "wand-sparkles");
      wand.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.triggerNoteDraw(embed);
      });
    }
    const more = actions.createEl("button", { cls: "mwv-browser-action", attr: { type: "button", title: "More", "aria-label": "More" } });
    more.dataset.mwvUrl = url;
    more.dataset.mwvTitle = title;
    setIcon(more, "more-horizontal");
    more.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const liveUrl = more.dataset.mwvUrl || embed.dataset.url || url;
      const liveTitle = more.dataset.mwvTitle || this.getEmbedSurfaceTitle(embed) || title || hostName(liveUrl);
      this.toggleMorePanel(embed, chrome, liveUrl, liveTitle);
    });
    const status = embed.createDiv({ cls: "mwv-browser-status" });
    status.createDiv({ cls: "mwv-browser-page-title", text: title || hostName(url) });
    status.createDiv({ cls: "mwv-browser-status-text", text: hostName(url) });
    this.renderBookmarksBar(embed);
    const initialMode = ["note", "web", "split"].includes(embed.dataset.mwvBrowserMode ?? "")
      ? embed.dataset.mwvBrowserMode as "note" | "web" | "split"
      : this.settings.browserFrontendMode;
    setMode(initialMode || "note");
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
    head.createDiv({ cls: "mwv-extension-title", text: "More" });
    const close = head.createEl("button", { cls: "mwv-more-close", attr: { type: "button", "aria-label": "Close More" } });
    setIcon(close, "x");
    close.addEventListener("click", () => panel.remove());
    const body = panel.createDiv({ cls: "mwv-more-body" });
    const feedback = body.createDiv({
      cls: "mwv-more-feedback",
      text: `下载保存到: ${this.normalizeDownloadFolder()}`
    });
    const actions = body.createDiv({ cls: "mwv-more-actions" });
    const setFeedback = (message: string, isError = false) => {
      feedback.setText(message);
      feedback.toggleClass("is-error", isError);
    };
    const addAction = (
      icon: string,
      label: string,
      onClick: () => void | Promise<void>,
      closePanel = false
    ): HTMLButtonElement => {
      const button = actions.createEl("button", { cls: "mwv-more-action", attr: { type: "button", title: label } });
      setIcon(button, icon);
      button.createSpan({ text: label });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.disabled = true;
        setFeedback(`正在执行: ${label}`);
        void Promise.resolve(onClick())
          .then(() => {
            setFeedback(`已完成: ${label}`);
            if (closePanel) panel.remove();
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            setFeedback(`${label} 失败: ${message}`, true);
            void this.addConsole("error", `${label} failed: ${message}`, url);
            new Notice(`${label} failed`);
          })
          .finally(() => {
            button.disabled = false;
          });
      });
      return button;
    };

    addAction("download", `下载页 (${this.settings.downloads.length})`, () => {
      this.toggleDownloadsPanel(body);
    });
    addAction("external-link", "用浏览器打开", () => {
      window.open(url, "_blank");
    });
    addAction("smartphone", "Browser View", async () => {
      await this.activateBrowserView(url);
    }, true);
    addAction("copy", "Copy link", async () => {
      await navigator.clipboard.writeText(`[${title}](${url})`);
      new Notice("Copied link");
    });
    addAction("share-2", "Share", async () => {
      await this.sharePage(url, title || hostName(url));
    });
    addAction("search", "Find in page", () => {
      this.toggleEmbedFindPanel(embed);
    }, false);
    addAction("activity", "Browser status", () => {
      this.toggleEmbedBrowserStatusPanel(body, embed, url);
    }, false);
    addAction("wrench", "Open DevTools", async () => {
      const surface = embed.querySelector<BrowserSurfaceElement>(".mwv-live-frame");
      const opened = await this.openBrowserDevTools(surface ?? undefined);
      if (!opened) throw new Error("Current surface does not support DevTools");
    }, false);
    addAction("zoom-in", `Zoom in (${this.settings.pageZoom}%)`, async () => {
      await this.setPageZoom(this.settings.pageZoom + 10, embed);
    }, false);
    addAction("zoom-out", "Zoom out", async () => {
      await this.setPageZoom(this.settings.pageZoom - 10, embed);
    }, false);
    addAction("monitor-smartphone", this.settings.desktopMode ? "Mobile view" : "Desktop view", async () => {
      await this.toggleDesktopMode(embed);
    }, false);
    addAction("moon", this.settings.nightMode ? "Light mode" : "Night mode", async () => {
      await this.toggleBooleanMode("nightMode", embed, "Night mode");
    }, false);
    addAction("image-off", this.settings.noImageMode ? "Images on" : "No images", async () => {
      await this.toggleBooleanMode("noImageMode", embed, "No image mode");
      await this.refreshEmbed(embed);
    }, false);
    addAction("eye", this.settings.eyeProtectionMode ? "Eye mode off" : "Eye mode", async () => {
      await this.toggleBooleanMode("eyeProtectionMode", embed, "Eye mode");
    }, false);
    addAction("shield-check", this.settings.adBlockEnabled ? "Ad block off" : "Ad block", async () => {
      await this.toggleBooleanMode("adBlockEnabled", embed, "Ad block");
      await this.refreshEmbed(embed);
    }, false);
    addAction("scan", this.settings.markAdsEnabled ? "Unmark ads" : "Mark ads", async () => {
      await this.toggleBooleanMode("markAdsEnabled", embed, "Mark ads");
    }, false);
    addAction("glasses", this.settings.incognitoMode ? "Incognito off" : "Incognito", async () => {
      await this.toggleBooleanMode("incognitoMode", embed, "Incognito");
    }, false);
    addAction("maximize", this.settings.fullScreenMode ? "Exit fullscreen" : "Fullscreen", async () => {
      await this.toggleFullscreen(embed);
    }, false);
    addAction("file-x", this.settings.jsDisabled ? "Enable JS" : "Disable JS", async () => {
      await this.toggleBooleanMode("jsDisabled", embed, "JavaScript");
      await this.refreshEmbed(embed);
    }, false);
    addAction("smartphone", `Switch UA (${this.settings.userAgentMode})`, async () => {
      await this.toggleUserAgent(embed);
      await this.refreshEmbed(embed);
    }, false);
    addAction("rotate-cw", this.settings.rotatedMode ? "Rotate off" : "Rotate", async () => {
      await this.toggleBooleanMode("rotatedMode", embed, "Rotate");
    }, false);
    addAction("type", `Font ${this.settings.readerFontScale}%`, async () => {
      await this.adjustReaderFont(10, embed);
    }, false);
    addAction("download", "Download file", async () => {
      await this.downloadUrlFile(url);
      this.toggleDownloadsPanel(body);
    }, false);
    addAction("file-code", "Save HTML", async () => {
      await this.downloadCurrentPageHtml(url, title || hostName(url));
      this.toggleDownloadsPanel(body, "Saved HTML");
    }, false);
    addAction("archive", "Save MHT", async () => {
      await this.downloadCurrentPageMhtml(url, title || hostName(url));
      this.toggleDownloadsPanel(body, "Saved MHT");
    }, false);
    addAction("file-down", "Offline page", async () => {
      await this.saveOfflinePage(url, title || hostName(url));
      this.toggleDownloadsPanel(body, "Offline page saved");
    }, false);
    addAction("external-link", "Add desktop shortcut", async () => {
      const path = await this.createShortcutFile(url, title || hostName(url));
      this.toggleToolsPanel(body, "Desktop shortcut", [`Saved: ${path}`]);
    }, false);
    addAction("text-cursor-input", "Autofill page", async () => {
      const frame = embed.querySelector<BrowserSurfaceElement>(".mwv-live-frame");
      if (!frame) return;
      const count = await this.autofillFrame(frame, url);
      if (count) new Notice(`Autofilled ${count} field(s)`);
    });
    addAction(
      "star",
      this.settings.bookmarks.some((entry) => entry.url === url) ? "Remove bookmark" : "Add bookmark",
      async () => {
        const added = await this.toggleBookmarkEntry(url, title || hostName(url));
        new Notice(added ? "Bookmark added" : "Bookmark removed");
      }
    );
    addAction("book-open", "Add to reading list", async () => {
      await this.addReadingList({ title: title || hostName(url), url, time: Date.now() });
      new Notice("Added to reading list");
    });
    addAction("library", `Reading list (${this.settings.readingList.length})`, () => {
      this.toggleReadingListPanel(body);
    }, false);
    addAction("history", `History (${this.settings.history.length})`, () => {
      this.toggleHistoryPanel(body);
    }, false);
    addAction("download", `Downloads (${this.settings.downloads.length})`, () => {
      this.toggleDownloadsPanel(body);
    }, false);
    addAction("terminal", `反馈日志 (${this.settings.consoleEntries.length})`, () => {
      this.toggleConsolePanel(body, url);
    }, false);
    addAction("wand-sparkles", `Scripts (${activeScripts.length})`, () => {
      this.toggleUserScriptsPanel(body, url);
    }, false);
    addAction("settings", "Site settings", () => {
      this.toggleSiteSettingsPanel(body, url);
    }, false);
    addAction("radio", "Sniff media", () => {
      void this.toggleAssetsPanel(body, url, "media");
    }, false);
    addAction("layers", "Page resources", () => {
      void this.toggleAssetsPanel(body, url, "resources");
    }, false);
    addAction("code-2", "View source", () => {
      void this.toggleSourcePanel(body, url);
    }, false);
    addAction("wrench", "Developer tools", () => {
      void this.toggleAssetsPanel(body, url, "developer");
    }, false);
    addAction("languages", "Translate", () => {
      this.toggleTranslatePanel(body, embed, url);
    }, false);
    addAction("volume-2", "Read aloud", async () => {
      await this.readPageAloud(url);
    }, false);
    addAction("qr-code", "QR code", () => {
      this.toggleQrPanel(body, url);
    }, false);
    addAction("shield-alert", "Report URL", () => {
      this.toggleReportPanel(body, url);
    }, false);
    addAction("briefcase", "Toolbox", () => {
      this.toggleToolsPanel(body, "Toolbox", [
        `Mode: ${this.settings.desktopMode ? "Desktop" : "Mobile"}`,
        `UA: ${this.settings.userAgentMode}`,
        `JavaScript: ${this.settings.jsDisabled ? "Disabled" : "Enabled"}`,
        `Images: ${this.settings.noImageMode ? "Hidden" : "Shown"}`,
        `Ad block: ${this.settings.adBlockEnabled ? "On" : "Off"}`
      ]);
    }, false);
    addAction("trash", `Clear cache (${this.settings.pageCache.length})`, async () => {
      await this.clearCache();
      this.toggleConsolePanel(body, url, "Cache cleared");
    }, false);
    addAction("trash-2", "Clear data", async () => {
      await this.clearBrowsingData();
      this.toggleConsolePanel(body, url, "Browsing data cleared");
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
    chrome.insertAdjacentElement("afterend", panel);
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
    consolePanel.createDiv({ cls: "mwv-console-title", text: message ?? `反馈日志 · ${hostName(url)}` });
    const entries = this.settings.consoleEntries.slice(0, 10);
    if (!entries.length) {
      consolePanel.createDiv({ cls: "mwv-console-empty", text: "暂无日志。执行搜索、下载、保存、脚本后会出现在这里。" });
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
    readingPanel.createDiv({ cls: "mwv-reading-title", text: "Reading list" });
    const entries = this.settings.readingList.slice(0, 20);
    if (!entries.length) {
      readingPanel.createDiv({ cls: "mwv-reading-empty", text: "No saved pages" });
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
    historyPanel.createDiv({ cls: "mwv-history-title", text: "History" });
    const entries = this.settings.history.slice(0, 30);
    if (!entries.length) {
      historyPanel.createDiv({ cls: "mwv-history-empty", text: "No history yet" });
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
    downloadsPanel.createDiv({ cls: "mwv-downloads-title", text: message ?? "Downloads" });
    const entries = this.settings.downloads.slice(0, 20);
    if (!entries.length) {
      downloadsPanel.createDiv({ cls: "mwv-downloads-empty", text: "No downloads yet" });
      return;
    }
    for (const entry of entries) {
      const item = downloadsPanel.createDiv({ cls: `mwv-download-item is-${entry.status}` });
      const top = item.createDiv({ cls: "mwv-download-item-top" });
      top.createDiv({ cls: "mwv-download-item-title", text: entry.fileName || hostName(entry.url) });
      top.createDiv({ cls: "mwv-download-item-state", text: `${entry.status} · ${Math.round(entry.progress)}%` });
      const progress = item.createDiv({ cls: "mwv-download-progress" });
      progress.createDiv({ cls: "mwv-download-progress-fill", attr: { style: `width:${clampNumber(entry.progress, 0, 100)}%` } });
      item.createDiv({ cls: "mwv-download-item-meta", text: `${entry.connections} connection${entry.connections === 1 ? "" : "s"} · ${entry.resumable ? "Range" : "single"} · ${entry.format.toUpperCase()}` });
      item.createDiv({ cls: "mwv-download-item-path", text: entry.path || entry.message || entry.url });
      const row = item.createDiv({ cls: "mwv-download-list-actions" });
      const open = row.createEl("button", { cls: "mwv-mini-action", text: "打开", attr: { type: "button" } });
      open.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.openDownloadEntry(entry);
      });
      const copy = row.createEl("button", { cls: "mwv-mini-action", text: "复制路径", attr: { type: "button" } });
      copy.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.copyDownloadPath(entry);
      });
      const locate = row.createEl("button", { cls: "mwv-mini-action", text: "位置", attr: { type: "button" } });
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
    translatePanel.createDiv({ cls: "mwv-translate-title", text: "Translate page" });
    const grid = translatePanel.createDiv({ cls: "mwv-translate-grid" });
    for (const language of TRANSLATE_CHOICES) {
      const button = grid.createEl("button", {
        cls: language.code === this.settings.translateTarget ? "mwv-translate-lang is-active" : "mwv-translate-lang",
        attr: { type: "button" }
      });
      button.createDiv({ cls: "mwv-translate-native", text: language.native });
      button.createDiv({ cls: "mwv-translate-label", text: language.label });
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.settings.translateTarget = language.code;
        await this.saveSettings();
        await this.openUrlInEmbed(embed, buildTranslateUrl(url, language.code));
        panel.remove();
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
    toolsPanel.createDiv({ cls: "mwv-tools-title", text: "Browser status" });
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
      ["JavaScript", this.settings.jsDisabled ? "Disabled" : "Enabled"],
      ["Images", this.settings.noImageMode ? "Hidden" : "Shown"],
      ["Ads", this.settings.adBlockEnabled ? "Blocked" : this.settings.markAdsEnabled ? "Marked" : "Allowed"],
      ["Mode", this.settings.desktopMode ? "Desktop" : "Mobile"],
      ["UA", this.settings.userAgentMode],
      ["History", this.settings.incognitoMode ? "Incognito" : "Saved"],
      ["Font", `${this.settings.readerFontScale}%`]
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
    const title = mode === "media" ? "Media resources" : mode === "developer" ? "Developer tools" : "Page resources";
    assetsPanel.createDiv({ cls: "mwv-assets-title", text: title });
    assetsPanel.createDiv({ cls: "mwv-assets-empty", text: "Loading..." });
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
        assetsPanel.createDiv({ cls: "mwv-assets-empty", text: "No resources found" });
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
    sourcePanel.createDiv({ cls: "mwv-source-title", text: "Page source" });
    sourcePanel.createDiv({ cls: "mwv-source-code", text: "Loading..." });
    try {
      const assets = await this.extractPageAssets(url);
      sourcePanel.empty();
      sourcePanel.createDiv({ cls: "mwv-source-title", text: "Page source" });
      const copy = sourcePanel.createEl("button", { cls: "mwv-source-copy", text: "Copy source", attr: { type: "button" } });
      copy.addEventListener("click", async () => {
        await navigator.clipboard.writeText(assets.html);
        new Notice("Source copied");
      });
      sourcePanel.createDiv({ cls: "mwv-source-code", text: assets.html.slice(0, 12000) });
    } catch (error) {
      sourcePanel.empty();
      sourcePanel.createDiv({ cls: "mwv-source-title", text: "Page source" });
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
    qrPanel.createDiv({ cls: "mwv-qr-title", text: "QR code" });
    qrPanel.createEl("img", {
      cls: "mwv-qr-image",
      attr: {
        src: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`,
        alt: "QR code"
      }
    });
    const copy = qrPanel.createEl("button", { cls: "mwv-source-copy", text: "Copy URL", attr: { type: "button" } });
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(url);
      new Notice("URL copied");
    });
  }

  toggleReportPanel(panel: HTMLElement, url: string): void {
    const existing = panel.querySelector<HTMLElement>(".mwv-report-panel");
    if (existing) {
      existing.remove();
      return;
    }
    this.removeUtilityPanels(panel);
    const reportPanel = panel.createDiv({ cls: "mwv-report-panel" });
    reportPanel.createDiv({ cls: "mwv-report-title", text: "Report URL" });
    reportPanel.createDiv({ cls: "mwv-report-row", text: hostName(url) });
    reportPanel.createDiv({ cls: "mwv-report-row", text: url });
    const copy = reportPanel.createEl("button", { cls: "mwv-source-copy", text: "Copy report", attr: { type: "button" } });
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(`Report URL\n${url}`);
      new Notice("Report copied");
    });
  }

  toggleUserScriptsPanel(panel: HTMLElement, url: string): void {
    const existing = panel.querySelector<HTMLElement>(".mwv-userscript-panel");
    if (existing) {
      existing.remove();
      return;
    }
    panel.querySelector<HTMLElement>(".mwv-console-panel")?.remove();
    panel.querySelector<HTMLElement>(".mwv-reading-panel")?.remove();
    panel.querySelector<HTMLElement>(".mwv-history-panel")?.remove();
    panel.querySelector<HTMLElement>(".mwv-downloads-panel")?.remove();
    const scriptsPanel = panel.createDiv({ cls: "mwv-userscript-panel" });
    const activeRules = this.getActiveUserScriptRules(url);
    scriptsPanel.createDiv({ cls: "mwv-userscript-title", text: `User scripts · ${hostName(url)}` });
    if (!this.settings.userScriptsEnabled) {
      scriptsPanel.createDiv({ cls: "mwv-userscript-empty", text: "Disabled" });
      return;
    }
    if (!activeRules.length) {
      scriptsPanel.createDiv({ cls: "mwv-userscript-empty", text: "No matching scripts" });
      return;
    }
    for (const rule of activeRules) {
      const item = scriptsPanel.createDiv({ cls: "mwv-userscript-item" });
      item.createDiv({ cls: "mwv-userscript-name", text: rule.name || "Unnamed script" });
      item.createDiv({ cls: "mwv-userscript-match", text: rule.match || "*://*/*" });
      const state = item.createDiv({ cls: "mwv-userscript-state" });
      state.createSpan({ text: rule.css.trim() ? "CSS" : "No CSS" });
      state.createSpan({ text: rule.js.trim() ? "JS" : "No JS" });
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
    const panel = document.createElement("div");
    panel.addClass("mwv-find-panel");
    const input = panel.createEl("input", {
      cls: "mwv-find-input",
      attr: { type: "search", placeholder: "Find in page", autocomplete: "off" }
    });
    const prev = panel.createEl("button", { cls: "mwv-find-button", attr: { type: "button", title: "Previous" } });
    setIcon(prev, "chevron-up");
    const next = panel.createEl("button", { cls: "mwv-find-button", attr: { type: "button", title: "Next" } });
    setIcon(next, "chevron-down");
    const close = panel.createEl("button", { cls: "mwv-find-button", attr: { type: "button", title: "Close" } });
    setIcon(close, "x");
    const status = panel.createDiv({ cls: "mwv-find-status", text: "0" });
    chrome?.insertAdjacentElement("afterend", panel) ?? embed.prepend(panel);

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
    embed.empty();
    embed.addClass("mwv-embed");
    embed.addClass("mwv-note-embed");
    embed.dataset.url = page.url;
    embed.removeClass("mwv-bing-home");
    this.renderBrowserChrome(embed, page.url, page.title || hostName(page.url));
    embed.createDiv({ cls: "mwv-note-source", text: page.byline || hostName(page.url) });
    embed.createEl("h2", { cls: "mwv-page-title", text: page.title || hostName(page.url) });
    if (page.images.length) {
      const media = embed.createDiv({ cls: "mwv-page-media" });
      for (const image of page.images.slice(0, 4)) {
        media.createEl("img", { attr: { src: image, alt: "" } });
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
      links.createEl("h3", { text: "Links" });
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
    return {
      id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: this.extractBingQuery(nextUrl) ? "Bing" : hostName(nextUrl),
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
    const temp = document.createElement("div");
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
    new Notice("File not found in vault; path copied");
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
      new Notice("HTML save failed");
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
      new Notice("MHT save failed");
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
      new Notice("Share text copied");
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
        ...Array.from(doc.querySelectorAll<HTMLImageElement>("img[src], img[data-src], img[data-original]")).map((item) => absoluteUrl(item.getAttribute("src") ?? item.getAttribute("data-src") ?? item.getAttribute("data-original") ?? "", url)),
        ...Array.from(doc.querySelectorAll<HTMLVideoElement | HTMLAudioElement | HTMLSourceElement>("video[src], audio[src], source[src]")).map((item) => absoluteUrl(item.getAttribute("src") ?? "", url)),
        ...Array.from(response.text.matchAll(/https?:\/\/[^\s"'<>]+?\.(?:mp4|m3u8|mp3|m4a|webm|mov|avi|flv)(?:\?[^\s"'<>]*)?/gi)).map((match) => match[0])
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
    doc.querySelectorAll<HTMLImageElement>("img[src], img[data-src], img[data-original]").forEach((element) => {
      const raw = element.getAttribute("src") ?? element.getAttribute("data-src") ?? element.getAttribute("data-original") ?? "";
      if (raw && !raw.startsWith("data:")) candidates.push({ element, attr: "src", url: absoluteUrl(raw, url) });
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
      new Notice("Download failed");
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

  supportsElectronWebview(): boolean {
    if (!document?.createElement) return false;
    const platform = typeof process !== "undefined" ? (process as NodeJS.Process & { versions?: Record<string, string> }).versions : undefined;
    if (!platform?.electron) return false;
    try {
      const probe = document.createElement("webview") as ElectronWebviewElement;
      probe.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
      document.body?.appendChild(probe);
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

  createBrowserSurface(
    parent: HTMLElement,
    url: string,
    className: string,
    title: string,
    callbacks: BrowserSurfaceCallbacks = {}
  ): BrowserSurfaceElement {
    if (this.supportsElectronWebview()) {
      const webview = document.createElement("webview") as ElectronWebviewElement;
      webview.addClass(className);
      webview.addClass("mwv-real-webview");
      webview.setAttribute("title", title);
      webview.setAttribute("allowpopups", "true");
      webview.setAttribute("partition", this.settings.incognitoMode ? `temp:mwv-${Date.now()}` : "persist:mobile-webviewer");
      webview.setAttribute("webpreferences", this.buildWebviewPreferences());
      if (this.settings.userAgentMode === "desktop" || this.settings.desktopMode) {
        webview.setAttribute("useragent", this.getUserAgentHeader());
      } else {
        webview.setAttribute("useragent", this.getUserAgentHeader());
      }
      if (url) webview.src = url;
      parent.appendChild(webview);
      this.bindRealBrowserSurface(webview, callbacks);
      return webview;
    }

    const frame = parent.createEl("iframe", {
      cls: className,
      attr: {
        title,
        sandbox: this.buildFrameSandbox(className.includes("mwv-live-frame")),
        referrerpolicy: "strict-origin-when-cross-origin"
      }
    });
    if (url) frame.src = url;
    frame.addEventListener("load", () => {
      void callbacks.onReady?.();
      try {
        const frameTitle = frame.contentDocument?.title;
        if (frameTitle) void callbacks.onTitle?.(frameTitle);
      } catch {
        // Cross-origin iframe title is not readable.
      }
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

  bindRealBrowserSurface(webview: ElectronWebviewElement, callbacks: BrowserSurfaceCallbacks): void {
    const emitNavigate = (event: Event) => {
      const detail = event as Event & { url?: string };
      const url = detail.url || webview.getURL?.() || webview.src;
      const downloadUrl = this.extractInternalDownloadUrl(url);
      if (downloadUrl) {
        webview.stop?.();
        void callbacks.onDownloadCandidate?.(downloadUrl);
        return;
      }
      if (url) void callbacks.onNavigate?.(url);
    };
    const emitTitle = (event: Event) => {
      const detail = event as Event & { title?: string };
      const title = detail.title || webview.getTitle?.() || "";
      if (title) void callbacks.onTitle?.(title);
    };

    webview.addEventListener("dom-ready", () => {
      this.applyWebviewRuntime(webview);
      this.installWebviewBrowserBridge(webview, callbacks);
      void callbacks.onReady?.();
      const title = webview.getTitle?.();
      if (title) void callbacks.onTitle?.(title);
    });
    webview.addEventListener("did-start-navigation", (event) => {
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
    });
    webview.addEventListener("will-navigate", (event) => {
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
    });
    webview.addEventListener("did-start-loading", () => {
      webview.removeClass("has-load-error");
      void callbacks.onLoading?.(true, webview.getURL?.() || webview.src);
    });
    webview.addEventListener("did-stop-loading", () => {
      void callbacks.onLoading?.(false, webview.getURL?.() || webview.src);
    });
    webview.addEventListener("did-navigate", emitNavigate);
    webview.addEventListener("did-navigate-in-page", emitNavigate);
    webview.addEventListener("page-title-updated", emitTitle);
    webview.addEventListener("page-favicon-updated", (event) => {
      const detail = event as Event & { favicons?: string[] };
      const favicon = detail.favicons?.find(Boolean);
      if (favicon) void callbacks.onFavicon?.(favicon);
    });
    webview.addEventListener("did-finish-load", () => {
      webview.removeClass("has-load-error");
      const url = webview.getURL?.() || webview.src;
      if (url) void callbacks.onNavigate?.(url);
      const title = webview.getTitle?.();
      if (title) void callbacks.onTitle?.(title);
    });
    webview.addEventListener("did-fail-load", (event) => {
      const detail = event as Event & { errorDescription?: string; validatedURL?: string; errorCode?: number };
      if (detail.errorCode === -3) return;
      webview.addClass("has-load-error");
      void callbacks.onFail?.(detail.errorDescription || "Load failed", detail.validatedURL || webview.getURL?.() || webview.src);
    });
    webview.addEventListener("console-message", (event) => {
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
        } catch {
          // Fall through to normal console logging.
        }
      }
      const level = detail.level === 2 ? "error" : detail.level === 1 ? "warn" : "info";
      if (detail.message) void callbacks.onConsole?.(level, detail.message, webview.getURL?.() || webview.src);
    });
    webview.addEventListener("new-window", (event) => {
      const detail = event as Event & { url?: string; preventDefault?: () => void };
      if (!detail.url) return;
      detail.preventDefault?.();
      void callbacks.onNewWindow?.(detail.url);
    });
    webview.addEventListener("ipc-message", (event) => {
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
      }
    });
  }

  installWebviewBrowserBridge(webview: ElectronWebviewElement, callbacks: BrowserSurfaceCallbacks): void {
    if (!webview.executeJavaScript) return;
    const code = `
      (() => {
        if (window.__mwvBrowserBridgeInstalled) return;
        window.__mwvBrowserBridgeInstalled = true;
        const filePattern = ${BINARY_URL_PATTERN.toString()};
        const send = (kind, url, title) => {
          try {
            console.info("__MWV_BRIDGE__" + JSON.stringify({ kind, url, title: title || "" }));
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
      })();
    `;
    webview.executeJavaScript(code, false).catch(() => {
      void callbacks.onConsole?.("warn", "Browser bridge injection failed", webview.getURL?.() || webview.src);
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
        ? surface.getURL?.() || surface.src || fallbackUrl
        : surface.src || fallbackUrl
      : fallbackUrl;
    const rows = [
      `内核: ${isWebview ? "Electron Chromium webview" : surface ? "iframe fallback" : "未找到页面层"}`,
      `当前地址: ${currentUrl}`,
      `标题: ${surface ? this.getBrowserSurfaceTitle(surface) || hostName(currentUrl) : hostName(currentUrl)}`,
      `加载中: ${isWebview && surface.isLoading?.() ? "是" : "否"}`,
      `可后退: ${isWebview && surface.canGoBack?.() ? "是" : "否"}`,
      `可前进: ${isWebview && surface.canGoForward?.() ? "是" : "否"}`,
      `DevTools: ${isWebview && typeof surface.openDevTools === "function" ? "可用" : "不可用"}`,
      `缩放: ${this.settings.pageZoom}%`,
      `页面模式: ${this.settings.userAgentMode} / ${this.settings.desktopMode ? "desktop width" : "mobile width"}`,
      `下载目录: ${this.normalizeDownloadFolder()}`
    ];
    return rows;
  }

  async openBrowserDevTools(surface?: BrowserSurfaceElement): Promise<boolean> {
    if (!this.isElectronWebview(surface) || typeof surface.openDevTools !== "function") {
      await this.addConsole("warn", "DevTools unavailable on current browser surface");
      return false;
    }
    try {
      surface.openDevTools();
      await this.addConsole("info", "Opened webview DevTools", surface.getURL?.() || surface.src);
      return true;
    } catch (error) {
      await this.addConsole("error", `Open DevTools failed: ${error instanceof Error ? error.message : String(error)}`, surface.getURL?.() || surface.src);
      return false;
    }
  }

  async applyWebviewRuntime(webview: ElectronWebviewElement): Promise<void> {
    const zoom = clampNumber(this.settings.pageZoom || 100, 50, 200) / 100;
    try {
      webview.setZoomFactor?.(zoom);
    } catch {
      await this.addConsole("warn", "Webview zoom unavailable", webview.getURL?.() || webview.src);
    }

    const cssParts: string[] = [];
    if (this.settings.noImageMode) {
      cssParts.push("img,picture,source[srcset],video[poster]{display:none!important;}");
    }
    if (this.settings.adBlockEnabled) {
      cssParts.push("[id*='ad' i],[class*='ad-' i],[class*='ads' i],[class*='advert' i],iframe[src*='ad' i],[aria-label*='advert' i]{display:none!important;}");
    } else if (this.settings.markAdsEnabled) {
      cssParts.push("[id*='ad' i],[class*='ad-' i],[class*='ads' i],[class*='advert' i],iframe[src*='ad' i],[aria-label*='advert' i]{outline:2px dashed #ef4444!important;outline-offset:2px!important;}");
    }
    if (this.settings.eyeProtectionMode) {
      cssParts.push("html{background:#f3f8ea!important;} body{background:#f3f8ea!important;}");
    }
    if (this.settings.nightMode) {
      cssParts.push("html{filter:brightness(.82) contrast(1.08)!important;background:#101112!important;}");
    }
    if (!cssParts.length || !webview.executeJavaScript) return;

    const css = cssParts.join("\n");
    const code = `
      (() => {
        const id = "mwv-runtime-style";
        document.getElementById(id)?.remove();
        const style = document.createElement("style");
        style.id = id;
        style.textContent = ${JSON.stringify(css)};
        document.documentElement.appendChild(style);
      })();
    `;
    try {
      await webview.executeJavaScript(code, false);
    } catch {
      await this.addConsole("warn", "Webview runtime filters limited", webview.getURL?.() || webview.src);
    }
  }

  getUserAgentHeader(): string {
    if (this.settings.userAgentMode === "desktop" || this.settings.desktopMode) {
      return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
    }
    return "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36";
  }

  requestHeaders(accept: string): Record<string, string> {
    return {
      "Accept": accept,
      "User-Agent": this.getUserAgentHeader()
    };
  }

  applyBrowserRuntimeClasses(root: HTMLElement): void {
    root.toggleClass("mwv-night-mode", this.settings.nightMode);
    root.toggleClass("mwv-no-images", this.settings.noImageMode);
    root.toggleClass("mwv-eye-protection", this.settings.eyeProtectionMode);
    root.toggleClass("mwv-adblock-on", this.settings.adBlockEnabled);
    root.toggleClass("mwv-mark-ads", this.settings.markAdsEnabled);
    root.toggleClass("mwv-incognito", this.settings.incognitoMode);
    root.toggleClass("mwv-fullscreen", this.settings.fullScreenMode);
    root.toggleClass("mwv-rotated", this.settings.rotatedMode);
    root.style.setProperty("--mwv-reader-font-scale", String(clampNumber(this.settings.readerFontScale, 80, 160) / 100));
  }

  applyRuntimePreferencesIn(root: HTMLElement): void {
    this.applyBrowserRuntimeClasses(root);
    this.applyFramePreferencesIn(root);
    root.querySelectorAll<BrowserSurfaceElement>(".mwv-frame, .mwv-live-frame").forEach((frame) => {
      if (this.isElectronWebview(frame)) {
        frame.setAttribute("webpreferences", this.buildWebviewPreferences());
        frame.setAttribute("useragent", this.getUserAgentHeader());
        void this.applyWebviewRuntime(frame);
      } else {
        frame.setAttribute("sandbox", this.buildFrameSandbox(frame.hasClass("mwv-live-frame")));
      }
    });
  }

  async applyAccessibleFrameFilters(frame: BrowserSurfaceElement, url: string): Promise<void> {
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
    const adSelector = "[id*='ad' i], [class*='ad-' i], [class*='ads' i], [class*='advert' i], iframe[src*='ad' i], [aria-label*='advert' i]";
    if (this.settings.adBlockEnabled) {
      doc.querySelectorAll(adSelector).forEach((node) => node.remove());
    } else if (this.settings.markAdsEnabled) {
      doc.querySelectorAll<HTMLElement>(adSelector).forEach((node) => node.addClass("mwv-ad-candidate"));
      const style = doc.createElement("style");
      style.textContent = ".mwv-ad-candidate{outline:2px dashed #ef4444!important;outline-offset:2px!important;}";
      doc.head?.appendChild(style);
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
    const zoom = clampNumber(this.settings.pageZoom || 100, 50, 200);
    frame.style.setProperty("--mwv-page-zoom", String(zoom / 100));
    if (this.isElectronWebview(frame)) {
      frame.style.setProperty("zoom", "1");
      try {
        frame.setZoomFactor?.(zoom / 100);
      } catch {
        // The webview may not be ready yet; dom-ready reapplies zoom.
      }
    } else {
      frame.style.setProperty("zoom", `${zoom}%`);
    }
    frame.toggleClass("mwv-desktop-frame", this.settings.desktopMode);
    if (this.settings.desktopMode) {
      frame.style.minWidth = "980px";
    } else {
      frame.style.minWidth = "";
    }
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

  async toggleFullscreen(root?: HTMLElement): Promise<void> {
    this.settings.fullScreenMode = !this.settings.fullScreenMode;
    await this.saveSettings();
    if (root) {
      this.applyRuntimePreferencesIn(root);
      try {
        if (this.settings.fullScreenMode && !document.fullscreenElement) {
          await root.requestFullscreen?.();
        } else if (!this.settings.fullScreenMode && document.fullscreenElement) {
          await document.exitFullscreen?.();
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
      } else {
        try {
          const win = frame.contentWindow as (Window & {
            find?: (
              searchString: string,
              caseSensitive?: boolean,
              backwards?: boolean,
              wrapAround?: boolean,
              wholeWord?: boolean,
              searchInFrames?: boolean,
              showDialog?: boolean
            ) => boolean;
          }) | null;
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
      parent?.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
      parent?.normalize();
    }
  }

  markTextMatches(root: HTMLElement, query: string): number {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "gi");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
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
      const fragment = document.createDocumentFragment();
      for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        const index = match.index;
        if (index > lastIndex) fragment.appendChild(document.createTextNode(text.slice(lastIndex, index)));
        const mark = document.createElement("mark");
        mark.addClass("mwv-find-mark");
        mark.textContent = match[0];
        fragment.appendChild(mark);
        lastIndex = index + match[0].length;
        count++;
      }
      if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      node.parentNode?.replaceChild(fragment, node);
    }
    return count;
  }

  applyReaderCustomizations(container: HTMLElement, page: NotePage): void {
    if (!this.settings.userScriptsEnabled) return;
    const style = this.settings.readerUserStyle.trim();
    const script = this.settings.readerUserScript.trim();
    const rules = this.getActiveUserScriptRules(page.url);

    if (style) {
      const styleEl = container.createEl("style");
      styleEl.textContent = style;
    }

    if (script) {
      try {
        const run = new Function(
          "container",
          "page",
          "hostName",
          `"use strict";\n${script}`
        ) as (container: HTMLElement, page: NotePage, hostNameFn: (url: string) => string) => void;
        run(container, page, hostName);
        void this.addConsole("info", "Reader user script executed", page.url);
      } catch (error) {
        console.error("[mobile-webviewer] reader user script failed", error);
        void this.addConsole("error", `Reader user script failed: ${error instanceof Error ? error.message : String(error)}`, page.url);
      }
    }

    for (const rule of rules) {
      const ruleCss = rule.css.trim();
      const ruleJs = rule.js.trim();
      if (ruleCss) {
        const styleEl = container.createEl("style");
        styleEl.textContent = ruleCss;
      }
      if (!ruleJs) {
        if (ruleCss) void this.addConsole("info", `User script style applied: ${rule.name}`, page.url);
        continue;
      }
      try {
        const run = new Function(
          "container",
          "page",
          "hostName",
          "rule",
          `"use strict";\n${ruleJs}`
        ) as (container: HTMLElement, page: NotePage, hostNameFn: (url: string) => string, rule: UserScriptRule) => void;
        run(container, page, hostName, rule);
        void this.addConsole("info", `User script executed: ${rule.name}`, page.url);
      } catch (error) {
        console.error(`[mobile-webviewer] user script failed: ${rule.name}`, error);
        void this.addConsole("error", `User script failed (${rule.name}): ${error instanceof Error ? error.message : String(error)}`, page.url);
      }
    }
  }

  async autofillFrame(frame: BrowserSurfaceElement, url: string): Promise<number> {
    if (this.isElectronWebview(frame)) {
      const profile = {
        name: this.settings.autofillName.trim(),
        email: this.settings.autofillEmail.trim(),
        phone: this.settings.autofillPhone.trim(),
        address: this.settings.autofillAddress.trim()
      };
      if (!Object.values(profile).some(Boolean)) return 0;
      if (!frame.executeJavaScript) {
        await this.addConsole("warn", "Autofill unavailable in webview", url);
        return 0;
      }
      const code = `
        (() => {
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
          for (const el of Array.from(document.querySelectorAll("input, textarea"))) {
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
    } catch (error) {
      await this.addConsole("warn", "Autofill skipped by page isolation", url);
      return 0;
    }
  }

  autofillDocument(doc: Document): number {
    const profile = {
      name: this.settings.autofillName.trim(),
      email: this.settings.autofillEmail.trim(),
      phone: this.settings.autofillPhone.trim(),
      address: this.settings.autofillAddress.trim()
    };
    const values = Object.values(profile);
    if (!values.some(Boolean)) return 0;

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
      new Notice("No web link found");
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
    const images: string[] = [];
    const seenImages = new Set<string>();
    for (const image of Array.from(doc.querySelectorAll<HTMLImageElement>("img[src], img[data-src], img[data-original]"))) {
      const raw = image.getAttribute("src") ?? image.getAttribute("data-src") ?? image.getAttribute("data-original") ?? "";
      if (!raw || raw.startsWith("data:")) continue;
      const absolute = absoluteUrl(raw, url);
      if (!/^https?:\/\//i.test(absolute) || seenImages.has(absolute)) continue;
      seenImages.add(absolute);
      images.push(absolute);
      if (images.length >= 6) break;
    }

    doc.querySelectorAll("script, style, noscript, svg, canvas, iframe, nav, footer, form, aside").forEach((node) => node.remove());

    const title =
      textFromElement(doc.querySelector("meta[property='og:title']")) ||
      textFromElement(doc.querySelector("title")) ||
      hostName(url);
    const byline =
      textFromElement(doc.querySelector("meta[name='author']")) ||
      textFromElement(doc.querySelector("[rel='author'], .author, .byline")) ||
      hostName(url);

    const root =
      doc.querySelector("article") ||
      doc.querySelector("main") ||
      doc.querySelector("[role='main']") ||
      doc.body;
    if (!root) throw new Error("No readable document body");

    const blocks: string[] = [];
    const blockNodes = Array.from(root.querySelectorAll("h1, h2, h3, p, li, blockquote"));
    for (const node of blockNodes) {
      const text = textFromElement(node);
      if (text.length < 12) continue;
      const tag = node.tagName.toLowerCase();
      if (/^h[1-3]$/.test(tag)) {
        blocks.push(`${"#".repeat(Number(tag.slice(1)))} ${text}`);
      } else if (tag === "li") {
        blocks.push(`- ${text}`);
      } else {
        blocks.push(text);
      }
      if (blocks.join("\n").length > 18000) break;
    }

    if (!blocks.length) {
      const bodyText = textFromElement(root);
      if (bodyText) {
        for (const sentence of bodyText.split(/(?<=[。！？.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean)) {
          if (sentence.length < 12) continue;
          blocks.push(sentence);
          if (blocks.join("\n").length > 12000) break;
        }
      }
    }

    const links: SearchResult[] = [];
    const seen = new Set<string>();
    for (const anchor of Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
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
      excerpt: blocks.slice(0, 3).join(" ").slice(0, 420),
      images,
      content: blocks.join("\n\n"),
      links
    };
    await this.rememberPageCache(page);
    return page;
  }

  openSettings(): void {
    // @ts-expect-error Obsidian exposes setting at runtime.
    this.app.setting.open();
    // @ts-expect-error Obsidian exposes setting at runtime.
    this.app.setting.openTabById(this.manifest.id);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
    this.settings.browserFrontendMode = ["note", "web", "split"].includes(this.settings.browserFrontendMode)
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
    this.settings.eyeProtectionMode = typeof this.settings.eyeProtectionMode === "boolean" ? this.settings.eyeProtectionMode : false;
    this.settings.adBlockEnabled = typeof this.settings.adBlockEnabled === "boolean" ? this.settings.adBlockEnabled : true;
    this.settings.markAdsEnabled = typeof this.settings.markAdsEnabled === "boolean" ? this.settings.markAdsEnabled : false;
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
    this.ensureBrowserTab(this.settings.activeBrowserTabId);
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
    this.setPlaceholder("Translate page to...");
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

  async onChooseSuggestion(item: LanguageOption): Promise<void> {
    this.plugin.settings.translateTarget = item.code;
    await this.plugin.saveSettings();
    this.onTranslate(buildTranslateUrl(this.url, item.code));
  }
}

class MobileWebviewerSettingTab extends PluginSettingTab {
  plugin: MobileWebviewerPlugin;

  constructor(app: App, plugin: MobileWebviewerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  renderSectionTitle(text: string, desc?: string): void {
    const section = this.containerEl.createDiv({ cls: "mwv-settings-section" });
    section.createDiv({ cls: "mwv-settings-section-title", text });
    if (desc) section.createDiv({ cls: "mwv-settings-section-desc", text: desc });
  }

  pluginAssetResourcePath(path: string): string {
    const dir = this.plugin.manifest.dir ?? ".obsidian/plugins/mobile-webviewer";
    return this.app.vault.adapter.getResourcePath(normalizePath(`${dir}/${path}`));
  }

  renderSupportCodes(): void {
    const wrapper = this.containerEl.createDiv({ cls: "mwv-settings-support" });
    wrapper.createDiv({ cls: "mwv-settings-support-title", text: "支持双码" });
    wrapper.createDiv({
      cls: "mwv-settings-support-desc",
      text: "如果这个插件帮到你，可以扫码支持继续维护。"
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

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("mwv-settings");

    containerEl.createEl("h2", { text: "Mobile Webviewer" });

    this.renderSectionTitle("核心入口", "首页、搜索、两个浏览器入口和启动行为。");

    new Setting(containerEl)
      .setName("Home page")
      .setDesc("Default page opened by the home button.")
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
      .setName("Search URL")
      .setDesc("Use {{query}} as the encoded search text placeholder.")
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
      .setName("Note Browser current URL")
      .setDesc("The URL restored when opening the note-based browser.")
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
          .setButtonText("Home")
          .onClick(async () => {
            this.plugin.settings.noteBrowserUrl = this.plugin.settings.homeUrl;
            this.plugin.settings.noteBrowserBack = [];
            this.plugin.settings.noteBrowserForward = [];
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName("Open browser")
      .setDesc("Quickly open either surface from settings.")
      .addButton((button) =>
        button
          .setButtonText("Note Browser")
          .onClick(() => void this.plugin.openNoteBrowser(this.plugin.settings.noteBrowserUrl || this.plugin.settings.homeUrl))
      )
      .addButton((button) =>
        button
          .setButtonText("Browser View")
          .onClick(() => void this.plugin.activateBrowserView(this.plugin.settings.homeUrl))
      );

    new Setting(containerEl)
      .setName("Open on startup")
      .setDesc("Open the web viewer after Obsidian layout is ready.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.openOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    this.renderSectionTitle("界面和渲染", "控制手机工具栏、NoteDraw 魔法棒、阅读层和页面比例。");

    new Setting(containerEl)
      .setName("Compact mobile toolbar")
      .setDesc("Use smaller controls for phone screens.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.compactToolbar)
          .onChange(async (value) => {
            this.plugin.settings.compactToolbar = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show NoteDraw magic wand")
      .setDesc("Show the wand button in Mobile Webviewer surfaces when NoteDraw is available.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showFloatingWand)
          .onChange(async (value) => {
            this.plugin.settings.showFloatingWand = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Reader hint")
      .setDesc("Show reader-layer hints when the internal browser renders note-like pages.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showReaderHint)
          .onChange(async (value) => {
            this.plugin.settings.showReaderHint = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Live browser first")
      .setDesc("Show the live WebView surface above the note-style reader layer.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.liveBrowserFirst)
          .onChange(async (value) => {
            this.plugin.settings.liveBrowserFirst = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Frontend mode")
      .setDesc("Default foreground: editable note, full web page, or split view.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("note", "Editable note")
          .addOption("web", "Full web page")
          .addOption("split", "Split")
          .setValue(this.plugin.settings.browserFrontendMode)
          .onChange(async (value) => {
            this.plugin.settings.browserFrontendMode = value as "note" | "web" | "split";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-save web notes")
      .setDesc("Auto-save edited reader text and doodles into plugin data only. Use 存 MD to add a Markdown file to the vault.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSaveWebNotes)
          .onChange(async (value) => {
            this.plugin.settings.autoSaveWebNotes = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Web note folder")
      .setDesc("Manual 存 MD exports are saved here inside the vault.")
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
      .setName("Page zoom")
      .setDesc("Default zoom for live browser surfaces.")
      .addSlider((slider) =>
        slider
          .setLimits(50, 200, 10)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.pageZoom)
          .onChange(async (value) => {
            this.plugin.settings.pageZoom = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Reader font size")
      .setDesc("Reader/cache layer font size.")
      .addSlider((slider) =>
        slider
          .setLimits(80, 160, 10)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.readerFontScale)
          .onChange(async (value) => {
            this.plugin.settings.readerFontScale = clampNumber(Math.round(value), 80, 160);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Desktop view")
      .setDesc("Use a wider live browser surface.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.desktopMode)
          .onChange(async (value) => {
            this.plugin.settings.desktopMode = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("User agent")
      .setDesc("Used by internal fetch/search/download requests and the live browser surface where Obsidian exposes control.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("mobile", "Mobile")
          .addOption("desktop", "Desktop")
          .setValue(this.plugin.settings.userAgentMode)
          .onChange(async (value) => {
            this.plugin.settings.userAgentMode = value === "desktop" ? "desktop" : "mobile";
            await this.plugin.saveSettings();
          })
      );

    this.renderSectionTitle("下载", "保存文件、HTML、MHT 和离线页面。");

    new Setting(containerEl)
      .setName("Download folder")
      .setDesc("Files saved by More > Download, HTML, and MHT.")
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
      .setName("Download connections")
      .setDesc("Parallel byte-range connections when the server supports resumable downloads.")
      .addSlider((slider) =>
        slider
          .setLimits(1, 8, 1)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.downloadConnections)
          .onChange(async (value) => {
            this.plugin.settings.downloadConnections = clampNumber(Math.round(value), 1, 8);
            await this.plugin.saveSettings();
          })
      );

    this.renderSectionTitle("浏览模式", "这些开关会影响 Browser View 和 Note Browser 的内部渲染。");
    for (const option of [
      ["Night mode", "nightMode", "Darkens internal browser shell and reader surfaces."],
      ["No image mode", "noImageMode", "Hides images in internal reader surfaces and same-origin live pages."],
      ["Eye protection", "eyeProtectionMode", "Applies a softer reading tint."],
      ["Ad block", "adBlockEnabled", "Removes common ad containers where the page is accessible."],
      ["Mark ads", "markAdsEnabled", "Marks likely ad containers where the page is accessible."],
      ["Incognito", "incognitoMode", "Stops history and reader cache writes."],
      ["Disable JavaScript", "jsDisabled", "Reloads live pages without allow-scripts in the sandbox."],
      ["Rotate screen", "rotatedMode", "Uses a wider landscape-like browser surface."]
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

    this.renderSectionTitle("翻译", "默认跟随 Obsidian 语言，也可以指定固定目标语言。");

    new Setting(containerEl)
      .setName("Default translation language")
      .setDesc("Used by More > Translate and the language picker. Follow Obsidian language keeps translation tied to Obsidian's current UI language.")
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

    this.renderSectionTitle("脚本和阅读层", "Reader 层 CSS、JavaScript 和按网址匹配的脚本规则。");

    new Setting(containerEl)
      .setName("Reader user scripts")
      .setDesc("Apply custom CSS and JavaScript to the internal reader layer.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.userScriptsEnabled)
          .onChange(async (value) => {
            this.plugin.settings.userScriptsEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Reader CSS")
      .setDesc("CSS injected into rendered reader/cache pages.")
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
      .setName("Reader JavaScript")
      .setDesc("Runs with container, page, and hostName available.")
      .addTextArea((text) =>
        text
          .setPlaceholder("container.dataset.scriptRan = 'true';")
          .setValue(this.plugin.settings.readerUserScript)
          .onChange(async (value) => {
            this.plugin.settings.readerUserScript = value;
            await this.plugin.saveSettings();
          })
      );

    this.renderSectionTitle("User script rules");
    new Setting(containerEl)
      .setName(`Rules (${this.plugin.settings.userScriptRules.length})`)
      .setDesc("URL-matched CSS and JavaScript for the internal reader layer.")
      .addButton((button) =>
        button
          .setButtonText("Add rule")
          .onClick(async () => {
            this.plugin.settings.userScriptRules.unshift(createDefaultUserScriptRule());
            await this.plugin.saveSettings();
            this.display();
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
            .setPlaceholder("Rule name")
            .setValue(rule.name)
            .onChange(async (value) => {
              rule.name = value || "脚本";
              await this.plugin.saveSettings();
            })
        )
        .addButton((button) =>
          button
            .setButtonText("Delete")
            .onClick(async () => {
              this.plugin.settings.userScriptRules = this.plugin.settings.userScriptRules.filter((item) => item.id !== rule.id);
              await this.plugin.saveSettings();
              this.display();
            })
        );

      new Setting(group)
        .setName("Match")
        .setDesc("Supports substring or wildcard, for example *://*.example.com/*")
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
        .setName("CSS")
        .setDesc("Injected into matched reader pages.")
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
        .setName("JavaScript")
        .setDesc("Runs with container, page, hostName, and rule available.")
        .addTextArea((text) =>
          text
            .setPlaceholder("container.classList.add('mwv-script-enhanced');")
            .setValue(rule.js)
            .onChange(async (value) => {
              rule.js = value;
              await this.plugin.saveSettings();
            })
        );
    }

    this.renderSectionTitle("自动填充", "用于 More > Autofill page，仅填可访问页面里的空字段。");

    new Setting(containerEl)
      .setName("Autofill name")
      .setDesc("Used by More > Autofill page.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.autofillName)
          .onChange(async (value) => {
            this.plugin.settings.autofillName = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Autofill email")
      .setDesc("Used by More > Autofill page.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.autofillEmail)
          .onChange(async (value) => {
            this.plugin.settings.autofillEmail = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Autofill phone")
      .setDesc("Used by More > Autofill page.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.autofillPhone)
          .onChange(async (value) => {
            this.plugin.settings.autofillPhone = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Autofill address")
      .setDesc("Used by More > Autofill page.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.autofillAddress)
          .onChange(async (value) => {
            this.plugin.settings.autofillAddress = value;
            await this.plugin.saveSettings();
          })
      );

    this.renderSectionTitle("数据维护", "清理浏览记录、阅读缓存、下载记录和控制台日志。");

    new Setting(containerEl)
      .setName("Clear history")
      .setDesc(`${this.plugin.settings.history.length} saved entries.`)
      .addButton((button) =>
        button
          .setButtonText("Clear")
          .onClick(async () => {
            this.plugin.settings.history = [];
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName("Clear reader cache")
      .setDesc(`${this.plugin.settings.pageCache.length} cached pages.`)
      .addButton((button) =>
        button
          .setButtonText("Clear")
          .onClick(async () => {
            await this.plugin.clearCache();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName("Clear downloads")
      .setDesc(`${this.plugin.settings.downloads.length} saved download records. Files are not removed.`)
      .addButton((button) =>
        button
          .setButtonText("Clear")
          .onClick(async () => {
            this.plugin.settings.downloads = [];
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName("Reading list")
      .setDesc(`${this.plugin.settings.readingList.length} saved pages.`)
      .addButton((button) =>
        button
          .setButtonText("Clear")
          .onClick(async () => {
            this.plugin.settings.readingList = [];
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName("Clear console")
      .setDesc(`${this.plugin.settings.consoleEntries.length} console entries.`)
      .addButton((button) =>
        button
          .setButtonText("Clear")
          .onClick(async () => {
            this.plugin.settings.consoleEntries = [];
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName("Clear browsing data")
      .setDesc("Clear history, reader cache, and console entries. Bookmarks, reading list, and files are kept.")
      .addButton((button) =>
        button
          .setButtonText("Clear")
          .onClick(async () => {
            await this.plugin.clearBrowsingData();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName("Export bookmark note")
      .setDesc("Create a Markdown note containing current bookmarks.")
      .addButton((button) =>
        button
          .setButtonText("Create")
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
            new Notice("Bookmark note created");
          })
      );

    this.renderSupportCodes();
  }
}
