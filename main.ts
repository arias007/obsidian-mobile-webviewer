import {
  App,
  ItemView,
  Menu,
  Notice,
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
  type SettingDefinitionItem
} from "obsidian";
import * as qrcodeFactory from "qrcode-generator";

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
const NOTE_BROWSER_STARTUP_DEFAULT_VERSION = "0.3.37";
const AD_CANDIDATE_SELECTOR = [
  "[id*='ad' i]",
  "[class*='ad-' i]",
  "[class*='ads' i]",
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
  pageHtml: string;
  pageText: string;
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
  | "pageLoadLimited";

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
  pageLoadLimited: "Page loading is limited; an editable note layer is kept."
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
  pageLoadLimited: "页面加载受限，已保留可编辑笔记层。"
};

const UI_TEXT_ZH_HANT: UiDictionary = {
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

interface MobileWebviewerSettings {
  homeUrl: string;
  searchUrl: string;
  uiLanguage: string;
  openOnStartup: boolean;
  noteBrowserStartupDefaultVersion?: string;
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
  previewEl?: HTMLElement;
  button?: HTMLElement;
  file?: { path?: string };
  plugin?: unknown;
  surfaceType?: string;
  allowTextEdit?: boolean;
  toolMode?: string;
  currentEditor?: HTMLElement | null;
  formatToolbar?: HTMLElement | null;
  createFormatToolbar?: () => void;
  setEditMarkdownMode?: () => void;
  positionFormatToolbar?: () => void;
  applyWebEdits?: () => void;
  resizeCanvas?: () => void;
  render?: () => void;
  setFile?: (file?: { path?: string; name?: string; extension?: string }) => Promise<void>;
  toggle?: () => void | Promise<void>;
  onButtonClick?: (event?: Event) => void | Promise<void>;
  onButtonPointerDown?: (event?: Event) => void | Promise<void>;
  onButtonPointerUp?: (event?: Event) => void | Promise<void>;
  destroy?: () => void;
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

interface NoteDrawPluginLike {
  syncSourceControllers?: () => void;
  syncWebviewControllers?: () => void;
  syncMobileWebviewerHeaderButtons?: () => void;
  scheduleWebviewSync?: () => void;
  webviewControllers?: Map<HTMLElement, NoteDrawControllerLike>;
  drawingPathForFile?: (file?: { path?: string }) => string;
  writeDrawings?: (file?: { path?: string }, data?: unknown) => Promise<void>;
}

interface MobileWebviewerSyntheticEvent extends Event {
  _mwvSyntheticWebNoteSave?: boolean;
}

const DEFAULT_SETTINGS: MobileWebviewerSettings = {
  homeUrl: DEFAULT_HOME,
  searchUrl: DEFAULT_SEARCH,
  uiLanguage: DEFAULT_UI_LANGUAGE,
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
        "  img.addEventListener('click', () => {",
        "    const src = img.currentSrc || img.src;",
        "    if (src) window.open(src, '_blank');",
        "  });",
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
  }

  async onClose(): Promise<void> {
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
    this.titleEl = meta.createDiv({ cls: "mwv-title", text: this.plugin.tr("noteBrowser") });
    this.subtitleEl = meta.createDiv({ cls: "mwv-subtitle", text: this.plugin.tr("ready") });
    this.tabStripEl = header.createDiv({ cls: "mwv-tab-strip" });

    const frameWrap = root.createDiv({ cls: "mwv-frame-wrap" });
    this.homeEl = frameWrap.createDiv({ cls: "mwv-home mwv-virtual-md" });
    this.buildHome();

    this.surfaceEl = this.plugin.createBrowserSurface(frameWrap, "", "mwv-frame", this.plugin.tr("noteBrowser"), {
      onReady: () => this.handleSurfaceReady(),
      onNavigate: (url) => this.handleSurfaceNavigate(url),
      onTitle: (title) => this.handleSurfaceTitle(title),
      onFail: (message, url) => {
        this.subtitleEl.setText(message);
        void this.plugin.addConsole("warn", `Page load issue: ${message}`, url ?? this.currentUrl);
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
    this.syncSurfaceIdentity(url, this.currentTitle || hostName(url));
    this.plugin.setBrowserSurfaceUrl(this.surfaceEl, url);
  }

  syncSurfaceIdentity(url = this.currentUrl || this.plugin.settings.homeUrl, title = this.currentTitle || hostName(url)): void {
    const root = this.containerEl.children[1] as HTMLElement | undefined;
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
  }

  handleSurfaceReady(): void {
    this.syncSurfaceIdentity();
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
    article.createDiv({ cls: "mwv-note-source", text: "Mobile Webviewer / Bing backend" });
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
    if (this.plugin.isElectronWebview(this.surfaceEl) && this.surfaceEl.canGoBack?.()) {
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
    if (this.plugin.isElectronWebview(this.surfaceEl) && this.surfaceEl.canGoForward?.()) {
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
    if (this.plugin.isElectronWebview(this.surfaceEl) && this.surfaceEl.reload) {
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
    article.createDiv({ cls: "mwv-note-source", text: "Mobile Webviewer" });
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
    const status = actions.createSpan({ cls: "mwv-webnote-status", text: note?.markdownPath ? this.tr("savedMarkdown", { path: note.markdownPath }) : this.tr("autoSavedPlugin") });

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
      status.setText(this.tr("saving"));
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
    status?.setText(this.currentWebNote.markdownPath ? this.plugin.tr("savedMarkdown", { path: this.currentWebNote.markdownPath }) : this.plugin.tr("savedPlugin"));
    if (showNotice) new Notice(this.plugin.tr("webNoteSaved"));
    return this.currentWebNote;
  }

  async exportCurrentWebNote(status?: HTMLElement): Promise<void> {
    const saved = await this.saveCurrentWebNote(false, status);
    if (!saved) return;
    const exported = await this.plugin.exportWebNoteMarkdown(saved);
    this.currentWebNote = exported;
    status?.setText(this.plugin.tr("savedMarkdown", { path: exported.markdownPath }));
    new Notice(this.tr("savedTo", { path: exported.markdownPath }));
  }

  async openCurrentInNoteBrowser(): Promise<void> {
    const status = this.homeEl?.querySelector<HTMLElement>(".mwv-webnote-status") ?? undefined;
    await this.saveCurrentWebNote(false, status);
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
      status.setText(this.tr("saving"));
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
      window.open(url, "_blank");
    });
    addAction(pageActions, "copy", this.plugin.tr("copyLink"), () => runAsync(async () => {
      await navigator.clipboard.writeText(`[${title}](${url})`);
      new Notice(this.tr("copiedLink"));
    }));
    addAction(pageActions, "share-2", this.plugin.tr("share"), () => this.plugin.sharePage(url, title));
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
  settings: MobileWebviewerSettings = DEFAULT_SETTINGS;
  processorSeq = 0;
  noteDrawDedupeTimers = new WeakMap<HTMLElement, number>();
  noteDrawDrawingSaveTimers = new WeakMap<NoteDrawControllerLike, number>();
  noteDrawHeaderInterceptUntil = 0;

  tr(key: UiTextKey, values: Record<string, string | number> = {}): string {
    return translateUiText(this.settings.uiLanguage || DEFAULT_UI_LANGUAGE, key, values);
  }

  resolvedUiLanguage(): string {
    return resolveUiLanguageCode(this.settings.uiLanguage || DEFAULT_UI_LANGUAGE);
  }

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new MobileWebviewerView(leaf, this));
    this.registerMarkdownPostProcessor((el) => {
      this.processWebviewerEmbeds(el);
    });
    this.registerDomEvent(appDocument(), "click", (event) => {
      void this.handleGlobalBingEvent(event);
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
    this.registerDomEvent(appDocument(), "click", (event) => {
      this.handleNoteDrawHeaderButtonEvent(event);
    }, { capture: true });
    this.registerDomEvent(appDocument(), "touchend", (event) => {
      this.handleNoteDrawHeaderButtonEvent(event);
    }, { capture: true });
    this.installNoteDrawDedupeObserver();

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
      this.app.workspace.containerEl
        .querySelectorAll<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR)
        .forEach((root) => this.queueNoteDrawButtonDedupe(root));
      if (this.settings.openOnStartup) {
        void this.openNoteBrowser(this.settings.noteBrowserUrl || this.settings.homeUrl);
      }
    });
  }

  onunload(): void {
    // Preserve user-arranged leaves when the plugin unloads.
  }

  installNoteDrawDedupeObserver(): void {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (!isHtmlElement(node)) continue;
          if (!node.matches(NOTEDRAW_BUTTON_SELECTOR) && !node.querySelector(NOTEDRAW_BUTTON_SELECTOR)) continue;
          const root =
            node.closest<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR) ??
            (isHtmlElement(mutation.target) ? mutation.target.closest<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR) : null);
          if (!root) continue;
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

  noteDrawButtonBelongsToSurface(button: HTMLElement, surface: HTMLElement): boolean {
    if (button.closest(".view-actions")) return false;
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
    const baseSurfaces = root.matches(MWV_DEDUPE_ROOT_SELECTOR)
      ? [root, ...Array.from(root.querySelectorAll<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR))]
      : Array.from(root.querySelectorAll<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR));
    for (const surface of new Set(baseSurfaces)) {
      const hideSourceButton = (button: HTMLElement) => {
        button.addClass("mwv-notedraw-source-button");
        button.setAttribute("aria-hidden", "true");
        button.tabIndex = -1;
      };
      const buttons = Array.from(surface.querySelectorAll<HTMLElement>(NOTEDRAW_BUTTON_SELECTOR)).filter((button) =>
        !button.hasClass("mwv-notedraw-launcher") && this.noteDrawButtonBelongsToSurface(button, surface)
      );
      for (const button of buttons) {
        hideSourceButton(button);
      }
      const leaf = surface.closest<HTMLElement>(".workspace-leaf-content");
      leaf?.addClass("mwv-notedraw-surface-leaf");
      const headerButton = leaf?.querySelector<HTMLElement>(".view-actions .notedraw-header-button");
      if (headerButton) {
        leaf?.querySelectorAll<HTMLElement>(".view-actions .notedraw-webview-button:not(.notedraw-header-button)").forEach(hideSourceButton);
      }
    }
  }

  getNoteDrawSearchScopes(root?: HTMLElement): HTMLElement[] {
    const scopes: HTMLElement[] = [];
    if (root?.isConnected) {
      scopes.push(root);
      const leaf = root.closest<HTMLElement>(".workspace-leaf-content");
      if (leaf) scopes.push(leaf);
    }
    return [...new Set(scopes)];
  }

  findNoteDrawSourceButton(root?: HTMLElement): NoteDrawButtonElement | null {
    const scopes = this.getNoteDrawSearchScopes(root);

    for (const scope of scopes) {
      const buttons = Array.from(scope.querySelectorAll<HTMLElement>(NOTEDRAW_BUTTON_SELECTOR)).filter(
        (candidate) => candidate.isConnected && !candidate.hasClass("mwv-notedraw-launcher")
      );
      const direct = buttons.find((candidate) => {
        const controller = (candidate as NoteDrawButtonElement)._noteDrawController;
        const previewEl = controller?.previewEl;
        return previewEl === root || Boolean(previewEl && root?.contains(previewEl));
      });
      const webview = buttons.find((candidate) => {
        const controller = (candidate as NoteDrawButtonElement)._noteDrawController;
        const previewEl = controller?.previewEl;
        return candidate.hasClass("notedraw-webview-button") && (!previewEl || previewEl === root || Boolean(root?.contains(previewEl)));
      });
      const headerWebview = buttons.find((candidate) => {
        const controller = (candidate as NoteDrawButtonElement)._noteDrawController;
        const previewEl = controller?.previewEl;
        return candidate.hasClass("notedraw-header-button") && controller?.surfaceType === "webview" && (!previewEl || previewEl === root || Boolean(root?.contains(previewEl)));
      });
      const fallback = buttons[0];
      const picked = direct ?? headerWebview ?? webview ?? fallback;
      if (picked) return picked;
    }
    return null;
  }

  collectNoteDrawControllers(root?: HTMLElement): NoteDrawControllerLike[] {
    const scopes = this.getNoteDrawSearchScopes(root);

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

    const saveDelay = fromFormatToolbar ? 80 : 0;
    window.setTimeout(() => this.queueWebNoteSaveForSurface(surface, fromFormatToolbar), saveDelay);
    this.queueNoteDrawControllerSync(surface, false);
  }

  handleNoteDrawHeaderButtonEvent(event: Event): void {
    const target = isHtmlElement(event.target) ? event.target : null;
    const button = target?.closest<HTMLElement>(".notedraw-header-button");
    if (!button || button.hasClass("mwv-notedraw-activation-proxy")) return;

    const leaf = button.closest<HTMLElement>(".workspace-leaf-content");
    const surface =
      leaf?.querySelector<HTMLElement>(".mwv-embed[data-url], .mwv-note-embed[data-url], .mwv-root[data-url], .mwv-root") ??
      button.closest<HTMLElement>(MWV_DEDUPE_ROOT_SELECTOR);
    if (!surface || !this.isMobileWebviewerSurface(surface)) return;

    const now = Date.now();
    if (now < this.noteDrawHeaderInterceptUntil) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }

    const controller = this.findWebviewNoteDrawController(surface, true);
    if (!controller) {
      this.queueNoteDrawButtonDedupe(surface);
      this.queueNoteDrawControllerSync(surface, true);
      return;
    }

    (button as NoteDrawButtonElement)._noteDrawController = controller;
    button.toggleClass("is-active", this.isNoteDrawControllerActive(controller));
    button.addClass("notedraw-webview-button");
    button.setAttribute("aria-label", "Edit web page drawing");
    button.setAttribute("title", "Edit web page drawing");

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this.noteDrawHeaderInterceptUntil = now + 450;
    this.triggerNoteDraw(surface);
  }

  queueWebNoteSaveForSurface(surface: HTMLElement, immediate = false): void {
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
    if (!root?.isConnected) return;
    for (const delay of [0, 80, 220, 520]) {
      window.setTimeout(() => this.syncNoteDrawControllers(root, forceEditMode), delay);
    }
  }

  syncNoteDrawControllers(root?: HTMLElement, forceEditMode = false): void {
    for (const controller of this.collectNoteDrawControllers(root)) {
      if (!controller.previewEl?.isConnected || controller.surfaceType !== "webview") continue;
      if (!this.isMobileWebviewerSurface(controller.previewEl)) continue;

      controller.allowTextEdit = true;
      if ((!controller.formatToolbar || !controller.formatToolbar.isConnected) && typeof controller.createFormatToolbar === "function") {
        try {
          controller.createFormatToolbar();
        } catch (error) {
          console.warn("[mobile-webviewer] NoteDraw toolbar create skipped", error);
        }
      }

      const active = this.isNoteDrawControllerActive(controller);
      const currentEditor = controller.currentEditor;
      if (active && !currentEditor && forceEditMode && controller.toolMode !== "edit-md") {
        try {
          controller.setEditMarkdownMode?.();
        } catch (error) {
          console.warn("[mobile-webviewer] NoteDraw edit mode skipped", error);
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
  }

  queueNoteDrawDrawingSave(controller?: NoteDrawControllerLike | null): void {
    if (!controller?.file) return;
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

  getNoteDrawPlugin(): NoteDrawPluginLike | null {
    const pluginRegistry = (this.app as AppWithRuntimePlugins).plugins;
    const plugin = pluginRegistry?.plugins?.notedraw;
    return plugin && typeof plugin === "object" ? plugin : null;
  }

  findWorkspaceLeafForElement(root?: HTMLElement): WorkspaceLeaf | null {
    if (!root?.isConnected) return null;
    let match: WorkspaceLeaf | null = null;
    try {
      this.app.workspace.iterateAllLeaves((leaf) => {
        if (!match && leaf.view?.containerEl?.contains(root)) {
          match = leaf;
        }
      });
    } catch (error) {
      console.warn("[mobile-webviewer] workspace leaf lookup skipped", error);
    }
    return match;
  }

  refreshNoteDrawWorkspaceBinding(root?: HTMLElement, forceEditMode = false, emitWorkspaceEvents = true): void {
    if (!root?.isConnected) return;
    const noteDrawPlugin = this.getNoteDrawPlugin();
    const leaf = this.findWorkspaceLeafForElement(root);

    if (emitWorkspaceEvents) {
      const workspace = this.app.workspace as unknown as {
        activeLeaf?: WorkspaceLeaf | null;
        setActiveLeaf?: (leaf: WorkspaceLeaf, params?: { focus?: boolean }) => void;
        trigger?: (name: string, ...data: unknown[]) => void;
      };
      try {
        const isActiveLeaf = leaf && (workspace.activeLeaf === leaf || Boolean(root.closest(".workspace-leaf.mod-active, .workspace-leaf.is-active")));
        if (leaf && isActiveLeaf) {
          workspace.setActiveLeaf?.(leaf, { focus: true });
        }
      } catch (error) {
        console.warn("[mobile-webviewer] workspace focus skipped", error);
      }
      try {
        workspace.trigger?.("layout-change");
      } catch (error) {
        console.warn("[mobile-webviewer] workspace layout refresh skipped", error);
      }
      try {
        if (leaf) workspace.trigger?.("active-leaf-change", leaf);
      } catch (error) {
        console.warn("[mobile-webviewer] workspace active leaf refresh skipped", error);
      }
      try {
        const file = this.app.workspace.getActiveFile();
        if (file) workspace.trigger?.("file-open", file);
      } catch (error) {
        console.warn("[mobile-webviewer] workspace file refresh skipped", error);
      }
    }

    const run = (label: string, callback?: () => void) => {
      if (typeof callback !== "function") return;
      try {
        callback();
      } catch (error) {
        console.warn(`[mobile-webviewer] NoteDraw ${label} skipped`, error);
      }
    };

    run("source sync", () => noteDrawPlugin?.syncSourceControllers?.());
    run("webview sync", () => noteDrawPlugin?.syncWebviewControllers?.());
    run("header sync", () => noteDrawPlugin?.syncMobileWebviewerHeaderButtons?.());
    run("scheduled webview sync", () => noteDrawPlugin?.scheduleWebviewSync?.());
    this.queueNoteDrawButtonDedupe(root);
    this.queueNoteDrawControllerSync(root, forceEditMode);
  }

  notifyNoteDrawWebviewChanged(root?: HTMLElement, forceEditMode = false): void {
    if (!root?.isConnected) return;
    const delays = [0, 80, 180, 420, 900, 1600];
    delays.forEach((delay, index) => {
      window.setTimeout(() => {
        if (!root.isConnected) return;
        this.refreshNoteDrawWorkspaceBinding(root, forceEditMode, index === 0 || index === 2 || index === 4);
      }, delay);
    });
  }

  resetNoteDrawWebviewControllers(root?: HTMLElement): void {
    if (!root?.isConnected) return;
    const noteDrawPlugin = this.getNoteDrawPlugin();
    const controllers = new Set<NoteDrawControllerLike>();
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
      const pendingTimer = this.noteDrawDrawingSaveTimers.get(controller);
      if (pendingTimer) {
        window.clearTimeout(pendingTimer);
        this.noteDrawDrawingSaveTimers.delete(controller);
      }
      const data = (controller as NoteDrawControllerLike & { drawingData?: unknown }).drawingData;
      if (controller.file && data && typeof noteDrawPlugin?.writeDrawings === "function") {
        void noteDrawPlugin.writeDrawings(controller.file, data).catch((error) => {
          console.warn("[mobile-webviewer] NoteDraw drawing flush skipped", error);
        });
      }
      try {
        controller.destroy?.();
      } catch (error) {
        console.warn("[mobile-webviewer] NoteDraw controller reset skipped", error);
      }
    }
    root.querySelectorAll<HTMLElement>(NOTEDRAW_BUTTON_SELECTOR).forEach((button) => button.remove());
    root.querySelectorAll<HTMLElement>(".notedraw-toolbar, .notedraw-palette-panel, .notedraw-text-panel, .notedraw-selection-menu, .notedraw-format-toolbar, .notedraw-embed-layer, .notedraw-file-input, .notedraw-canvas").forEach((element) => element.remove());
    (root as NoteDrawSurfaceElement)._noteDrawController = undefined;
  }

  isMobileWebviewerSurface(surface?: HTMLElement | null): boolean {
    if (!surface) return false;
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
      if (toggleController(webviewController)) {
        return;
      }
      if (clickController(webviewController)) {
        return;
      }
      const activeController = this.findActiveNoteDrawController(root);
      if (activeController && toggleController(activeController)) {
        return;
      }
      const button = this.findNoteDrawSourceButton(root);
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

  async openNoteBrowser(input?: string): Promise<void> {
    if (input) {
      this.settings.noteBrowserUrl = normalizeInput(input, this.settings.searchUrl);
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
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    this.setNoteBrowserReadingMode(leaf);
  }

  setNoteBrowserReadingMode(leaf: WorkspaceLeaf): void {
    const view = leaf.view as { setState?: (state: Record<string, unknown>, result?: unknown) => Promise<void>; getState?: () => Record<string, unknown> };
    for (const delay of [80, 240, 600]) {
      window.setTimeout(() => {
        try {
          const state = view.getState?.() ?? {};
          void view.setState?.({ ...state, mode: "preview", source: false }, { history: false });
        } catch (error) {
          console.warn("[mobile-webviewer] note browser preview mode skipped", error);
        }
      }, delay);
    }
  }

  async ensureWebviewerNote(): Promise<TFile> {
    const content = [
      "# Mobile Webviewer",
      "",
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
      embed.dataset.mwvBrowserMode = "note";
      const tab = this.ensureBrowserTab(this.settings.activeBrowserTabId);
      embed.dataset.mwvActiveTabId = tab.id;
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
      new Notice(this.tr("copiedLink"));
      return;
    }

    const openTarget =
      event.type === "click"
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
    const side = shell.createDiv({ cls: "mwv-bing-side" });

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
    if (currentUrl && currentUrl !== nextUrl) {
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
    const nextUrl = normalizeInput(url, this.settings.searchUrl);
    const previousUrl = embed.dataset.url;
    await this.flushEmbedReaderNow(embed);
    if (previousUrl && previousUrl !== nextUrl) {
      this.resetNoteDrawWebviewControllers(embed);
    }
    if (recordHistory) {
      this.pushEmbedHistory(embed, nextUrl);
    } else {
      embed.dataset.url = nextUrl;
      embed.dataset.mwvProgrammaticUrl = nextUrl;
      embed.setAttribute("data-url", nextUrl);
      void this.persistEmbedState(embed);
    }
    const utilityKind = internalUtilityKind(nextUrl);
    if (utilityKind) {
      this.renderUtilityEmbed(embed, utilityKind, nextUrl);
      await this.syncEmbedActiveTab(embed, nextUrl, utilityPageTitle(utilityKind));
      return;
    }
    const query = this.extractBingQuery(nextUrl);
    if (this.isBingHome(nextUrl) || query !== null) {
      this.renderBingShellEmbed(embed, query ?? "");
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
      return;
    }
    tabs.splice(index, 1);
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
    await this.flushEmbedReaderNow(embed);
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
    await this.flushEmbedReaderNow(embed);
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
    page.createDiv({ cls: "mwv-note-source", text: "Mobile Webviewer" });
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

  async renderEmbed(embed: HTMLElement, url: string): Promise<void> {
    const utilityKind = internalUtilityKind(url);
    if (utilityKind) {
      this.renderUtilityEmbed(embed, utilityKind, url);
      await this.syncEmbedActiveTab(embed, url, utilityPageTitle(utilityKind));
      return;
    }
    const query = this.extractBingQuery(url);
    if (this.isBingHome(url) || query !== null) {
      this.renderBingShellEmbed(embed, query ?? "");
      await this.syncEmbedActiveTab(embed, url, query ? `Bing: ${query}` : "Bing");
      return;
    }

    embed.empty();
    embed.addClass("mwv-embed");
    embed.addClass("mwv-note-embed");
    embed.dataset.url = url;
    embed.setAttribute("data-url", url);
    embed.removeClass("mwv-bing-home");
    this.renderBrowserChrome(embed, url, this.tr("loading"));
    this.notifyNoteDrawWebviewChanged(embed);

    if (this.settings.liveBrowserFirst) {
      const reader = embed.createDiv({ cls: "mwv-reader-panel is-loading mwv-note-front-panel" });
      reader.createDiv({ cls: "mwv-reader-panel-title", text: this.tr("reader") });
      reader.createDiv({ cls: "mwv-reader-loading-text", text: this.tr("readerExtracting") });
      this.renderLiveBrowserSurface(embed, url);
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
    const surface = embed.createDiv({ cls: "mwv-live-browser" });
    const frame = this.createBrowserSurface(surface, url, "mwv-live-frame", hostName(url), {
      onReady: () => {
        void this.applyAccessibleFrameFilters(frame, embed.dataset.url || url);
        this.notifyNoteDrawWebviewChanged(embed);
      },
      onNavigate: (nextUrl) => this.handleEmbedSurfaceNavigate(embed, nextUrl),
      onTitle: (title) => this.handleEmbedSurfaceTitle(embed, title),
      onFail: (message, failedUrl) => {
        const currentUrl = failedUrl ?? embed.dataset.url ?? url;
        this.updateEmbedStatus(embed, currentUrl, hostName(currentUrl));
        void this.addConsole("warn", `Note Browser load issue: ${message}`, currentUrl);
        void this.renderEmbedReaderFallback(embed, currentUrl, message);
        this.notifyNoteDrawWebviewChanged(embed);
      },
      onConsole: (level, message, pageUrl) => this.addConsole(level, message, pageUrl ?? embed.dataset.url ?? url),
      onNewWindow: (nextUrl) => this.activateBrowserView(nextUrl, true),
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

  handleEmbedSurfaceNavigate(embed: HTMLElement, url: string): void {
    if (!url || url === "about:blank" || url.startsWith("devtools://")) return;
    const nextUrl = normalizeInput(url, this.settings.searchUrl);
    const previous = embed.dataset.url;
    const programmaticUrl = embed.dataset.mwvProgrammaticUrl;
    if (previous && previous !== nextUrl) {
      void this.flushEmbedReaderNow(embed);
      this.resetNoteDrawWebviewControllers(embed);
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
    this.notifyNoteDrawWebviewChanged(embed);
    void this.persistEmbedState(embed);
    void this.syncEmbedActiveTab(embed, nextUrl, this.getEmbedSurfaceTitle(embed) || hostName(nextUrl));
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
    const lock = embed.querySelector<HTMLElement>(".mwv-browser-lock");
    if (lock) lock.setText(/^https:\/\//i.test(url) ? "https" : "page");
    const titleEl = embed.querySelector<HTMLElement>(".mwv-browser-page-title");
    if (titleEl) titleEl.setText(title || hostName(url));
    const status = embed.querySelector<HTMLElement>(".mwv-browser-status-text");
    if (status) status.setText(hostName(url));
    const more = embed.querySelector<HTMLElement>(".mwv-browser-more");
    if (more) {
      more.dataset.mwvUrl = url;
      more.dataset.mwvTitle = title;
    }
    this.renderEmbedTabStrip(embed);
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
    const status = actions.createSpan({ cls: "mwv-webnote-status", text: note?.markdownPath ? this.tr("savedMarkdown", { path: note.markdownPath }) : this.tr("autoSavedPlugin") });
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
      status.setText(saved.markdownPath ? this.tr("savedMarkdown", { path: saved.markdownPath }) : this.tr("savedPlugin"));
      return saved;
    };
    const queue = () => {
      if (!this.settings.autoSaveWebNotes) return;
      status.setText(this.tr("saving"));
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
      status.setText(this.tr("saving"));
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

  renderBingShellEmbed(embed: HTMLElement, query = ""): void {
    void this.flushEmbedReaderNow(embed);
    this.resetNoteDrawWebviewControllers(embed);
    embed.empty();
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
    this.notifyNoteDrawWebviewChanged(embed);

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
      const tabs = embed.createDiv({ cls: "mwv-bing-tabs" });
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

    const resultHost = embed.createDiv({ cls: "mwv-bing-results" });
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
    embed.createDiv({ cls: "mwv-tab-strip mwv-embed-tab-strip" });
    this.renderEmbedTabStrip(embed);
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

    makeNavButton("arrow-left", this.tr("back"), () => void this.navigateEmbedBack(embed), this.getEmbedStack(embed, "mwvBack").length === 0);
    makeNavButton("arrow-right", this.tr("forward"), () => void this.navigateEmbedForward(embed), this.getEmbedStack(embed, "mwvForward").length === 0);
    makeNavButton("rotate-cw", this.tr("reload"), () => void this.refreshEmbed(embed));
    makeNavButton("home", this.tr("home"), () => void this.openUrlInEmbed(embed, this.settings.homeUrl));
    makeModeButton("file-text", this.tr("note"), "note");
    makeModeButton("globe-2", this.tr("web"), "web");
    makeNavButton("file-down", this.tr("saveMd"), () => void this.exportEmbedWebNote(embed));

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

    const actions = chrome.createDiv({ cls: "mwv-browser-actions" });
    const more = actions.createEl("button", { cls: "mwv-browser-action mwv-browser-more", attr: { type: "button", title: this.tr("more"), "aria-label": this.tr("more") } });
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
    const initialMode = ["note", "web"].includes(embed.dataset.mwvBrowserMode ?? "")
      ? embed.dataset.mwvBrowserMode as "note" | "web"
      : "note";
    setMode(initialMode || "note");
    this.watchEmbedChrome(embed);
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
          (node.hasClass("mwv-browser-chrome") || node.hasClass("mwv-browser-status") || node.hasClass("mwv-embed-tab-strip") || node.querySelector?.(".mwv-browser-chrome, .mwv-browser-status, .mwv-embed-tab-strip"))
        );
        const missingChrome = !embed.querySelector(":scope > .mwv-browser-chrome") || !embed.querySelector(":scope > .mwv-embed-tab-strip");
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
    const strip = embed.querySelector<HTMLElement>(":scope > .mwv-embed-tab-strip");
    const status = embed.querySelector<HTMLElement>(":scope > .mwv-browser-status");
    if (chrome && strip && status) {
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
      embed.querySelector<HTMLElement>(":scope > .mwv-embed-tab-strip"),
      embed.querySelector<HTMLElement>(":scope > .mwv-browser-chrome"),
      embed.querySelector<HTMLElement>(":scope > .mwv-browser-status"),
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
    panel.querySelector<HTMLElement>(".mwv-webnote-status")?.setText(this.tr("savedMarkdown", { path: exported.markdownPath }));
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
      window.open(url, "_blank");
    });
    addAction(pageActions, "copy", this.tr("copyLink"), async () => {
      await navigator.clipboard.writeText(`[${title}](${url})`);
      new Notice(this.tr("copiedLink"));
    });
    addAction(pageActions, "share-2", this.tr("share"), async () => {
      await this.sharePage(url, title || hostName(url));
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
    const hasPagePatch = patch.pageEdited === true || Boolean(patch.pageHtml?.trim() || patch.pageText?.trim());
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
      window.setTimeout(() => {
        if (!frame.isConnected) return;
        const currentUrl = frame.src || url;
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
      void this.applyWebviewRuntime(webview);
      this.installWebviewBrowserBridge(webview, callbacks);
      this.hydrateWebviewPageNote(webview);
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
        void this.flushWebviewPageNote(webview, callbacks);
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
      void this.flushWebviewPageNote(webview, callbacks);
      if (url) void callbacks.onNavigate?.(url);
      const title = webview.getTitle?.();
      if (title) void callbacks.onTitle?.(title);
    });
    webview.addEventListener("did-fail-load", (event) => {
      const detail = event as Event & { errorDescription?: string; validatedURL?: string; errorCode?: number };
      if (detail.errorCode === -3) return;
      void this.flushWebviewPageNote(webview, callbacks);
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
          if (payload.kind === "webnote" && payload.url) {
            void callbacks.onWebNotePatch?.(payload as BrowserWebNotePatch);
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
    });
  }

  async flushWebviewPageNote(webview: ElectronWebviewElement, callbacks?: BrowserSurfaceCallbacks): Promise<void> {
    if (!webview.executeJavaScript) return;
    try {
      await webview.executeJavaScript("window.__mwvFlushPageNote && window.__mwvFlushPageNote();", false);
    } catch {
      void callbacks?.onConsole?.("warn", "Browser page note flush skipped", webview.getURL?.() || webview.src);
    }
  }

  installWebviewBrowserBridge(webview: ElectronWebviewElement, callbacks: BrowserSurfaceCallbacks): void {
    if (!webview.executeJavaScript) return;
    const code = `
      (() => {
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
            #mwv-page-note-bar{position:sticky;top:8px;margin:8px 8px 0 auto;width:max-content;display:flex;gap:6px;pointer-events:auto;}
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
            if (typeof payload.pageHtml === "string" && payload.pageHtml.trim() && !appliedSavedPageHtml) {
              const keepRoot = document.getElementById("mwv-page-note-root") || root;
              keepRoot.remove();
              doc.body.innerHTML = payload.pageHtml;
              doc.body.prepend(keepRoot);
              appliedSavedPageHtml = true;
            }
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
        if (doc.body) installWebNoteOverlay();
        else document.addEventListener("DOMContentLoaded", installWebNoteOverlay, { once: true });
      })();
    `;
    webview.executeJavaScript(code, false).catch(() => {
      void callbacks.onConsole?.("warn", "Browser bridge injection failed", webview.getURL?.() || webview.src);
    });
  }

  hydrateWebviewPageNote(webview: ElectronWebviewElement): void {
    if (!webview.executeJavaScript) return;
    const url = webview.getURL?.() || webview.src || "";
    const note = this.settings.webNotes.find((entry) => entry.id === webNoteId(url) || entry.url === url);
    if (!note) return;
    const payload = {
      noteHtml: note.noteHtml || "",
      noteText: note.noteText || "",
      doodleSvg: note.doodleSvg || "",
      pageHtml: note.pageHtml || "",
      pageText: note.pageText || ""
    };
    const code = `
      (() => {
        const payload = ${JSON.stringify(payload)};
        const apply = () => {
          if (typeof window.__mwvApplyPageNote === "function") {
            window.__mwvApplyPageNote(payload);
            return;
          }
          if (payload.pageHtml && doc.body && !doc.body.getAttribute("data-mwv-page-note-restored")) {
            doc.body.setAttribute("data-mwv-page-note-restored", "true");
            doc.body.innerHTML = payload.pageHtml;
          }
          const editor = document.getElementById("mwv-page-note-editor");
          const canvas = document.getElementById("mwv-page-note-canvas");
          if (editor && payload.noteHtml && !editor.innerHTML.trim()) editor.innerHTML = payload.noteHtml;
          if (canvas && payload.doodleSvg && !canvas.innerHTML.trim()) canvas.innerHTML = payload.doodleSvg;
        };
        apply();
        setTimeout(apply, 160);
        setTimeout(apply, 600);
      })();
    `;
    webview.executeJavaScript(code, false).catch(() => {
      void this.addConsole("warn", "Browser page note hydrate skipped", url);
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
    const zoom = clampNumber(this.settings.pageZoom || 100, 50, 200) / 100;
    try {
      webview.setZoomFactor?.(zoom);
    } catch {
      await this.addConsole("warn", "Webview zoom unavailable", webview.getURL?.() || webview.src);
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
      "Accept-Language": acceptLanguageHeader(this.settings.uiLanguage || DEFAULT_UI_LANGUAGE),
      "Cache-Control": "no-cache",
      "Upgrade-Insecure-Requests": "1",
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
    const zoom = clampNumber(this.settings.pageZoom || 100, 50, 200);
    frame.setCssProps({ "--mwv-page-zoom": String(zoom / 100) });
    if (this.isElectronWebview(frame)) {
      frame.setCssStyles({ zoom: "1" });
      try {
        frame.setZoomFactor?.(zoom / 100);
      } catch {
        // The webview may not be ready yet; dom-ready reapplies zoom.
      }
    } else {
      frame.setCssStyles({ zoom: `${zoom}%` });
    }
    frame.toggleClass("mwv-desktop-frame", this.settings.desktopMode);
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
        const sentenceSource = bodyText.replace(/([。！？.!?])\s+/g, "$1\n");
        for (const sentence of sentenceSource.split(/\n+/).map((part) => part.trim()).filter(Boolean)) {
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
