import {
  App,
  ItemView,
  Menu,
  Notice,
  Plugin,
  PluginSettingTab,
  requestUrl,
  Setting,
  TFile,
  WorkspaceLeaf,
  normalizePath,
  setIcon
} from "obsidian";

const VIEW_TYPE = "mobile-webviewer-view";
const DEFAULT_HOME = "https://www.bing.com/";
const DEFAULT_SEARCH = "https://www.bing.com/search?q={{query}}";
const WEBVIEW_NOTE_PATH = "Mobile Webviewer.md";
const MAX_HISTORY = 80;
const MAX_BOOKMARKS = 120;

interface WebEntry {
  title: string;
  url: string;
  time: number;
}

interface MobileWebviewerSettings {
  homeUrl: string;
  searchUrl: string;
  openOnStartup: boolean;
  compactToolbar: boolean;
  showReaderHint: boolean;
  showFloatingWand: boolean;
  history: WebEntry[];
  bookmarks: WebEntry[];
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface NotePage {
  title: string;
  url: string;
  byline: string;
  content: string;
  links: SearchResult[];
}

const DEFAULT_SETTINGS: MobileWebviewerSettings = {
  homeUrl: DEFAULT_HOME,
  searchUrl: DEFAULT_SEARCH,
  openOnStartup: false,
  compactToolbar: true,
  showReaderHint: true,
  showFloatingWand: true,
  history: [],
  bookmarks: [
    {
      title: "Bing",
      url: "https://www.bing.com/",
      time: Date.now()
    },
    {
      title: "Wikipedia",
      url: "https://www.wikipedia.org/",
      time: Date.now()
    }
  ]
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

function fallbackSearchResults(query: string): SearchResult[] {
  const url = DEFAULT_SEARCH.replace("{{query}}", encodeURIComponent(query));
  return [
    {
      title: `Open Bing results for "${query}"`,
      url,
      snippet: "Search result fetch is unavailable inside Obsidian. Tap to open the full Bing results page."
    }
  ];
}

class MobileWebviewerView extends ItemView {
  plugin: MobileWebviewerPlugin;
  iframeEl!: HTMLIFrameElement;
  homeEl!: HTMLElement;
  addressEl!: HTMLInputElement;
  titleEl!: HTMLElement;
  subtitleEl!: HTMLElement;
  drawerEl!: HTMLElement;
  listEl!: HTMLElement;
  bookmarksTabEl!: HTMLButtonElement;
  historyTabEl!: HTMLButtonElement;
  currentUrl = "";
  currentTitle = "";
  backStack: string[] = [];
  forwardStack: string[] = [];
  lastQuery = "";

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
    this.navigate(this.plugin.settings.homeUrl, false);
  }

  build(): void {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass("mwv-root");
    root.toggleClass("mwv-compact", this.plugin.settings.compactToolbar);

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
        placeholder: "Search or enter URL"
      }
    });
    const wandHeaderButton = form.createEl("button", {
      cls: "mwv-icon-button mwv-wand-inline",
      attr: { type: "button", "aria-label": "NoteDraw magic wand", title: "NoteDraw magic wand" }
    });
    setIcon(wandHeaderButton, "wand-sparkles");
    wandHeaderButton.addEventListener("click", () => this.triggerNoteDraw());
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

    const frameWrap = root.createDiv({ cls: "mwv-frame-wrap" });
    this.homeEl = frameWrap.createDiv({ cls: "mwv-home mwv-virtual-md" });
    this.buildHome();

    this.iframeEl = frameWrap.createEl("iframe", {
      cls: "mwv-frame",
      attr: {
        title: "Mobile Webviewer Browser",
        sandbox: "allow-forms allow-modals allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-top-navigation-by-user-activation",
        referrerpolicy: "strict-origin-when-cross-origin"
      }
    });

    this.iframeEl.addEventListener("load", () => {
      this.subtitleEl.setText(hostName(this.currentUrl));
      try {
        const title = this.iframeEl.contentDocument?.title;
        if (title) {
          this.currentTitle = title;
          this.titleEl.setText(title);
        }
      } catch {
        this.currentTitle = hostName(this.currentUrl);
      }
    });

    this.drawerEl = root.createDiv({ cls: "mwv-drawer" });
    const drawerHead = this.drawerEl.createDiv({ cls: "mwv-drawer-head" });
    const tabs = drawerHead.createDiv({ cls: "mwv-tabs" });
    this.bookmarksTabEl = tabs.createEl("button", { cls: "mwv-tab is-active", text: "Bookmarks" });
    this.historyTabEl = tabs.createEl("button", { cls: "mwv-tab", text: "History" });
    const closeDrawer = drawerHead.createEl("button", {
      cls: "mwv-icon-button",
      attr: { type: "button", "aria-label": "Close panel" }
    });
    setIcon(closeDrawer, "x");
    this.listEl = this.drawerEl.createDiv({ cls: "mwv-list" });

    closeDrawer.addEventListener("click", () => this.closeDrawer());
    this.bookmarksTabEl.addEventListener("click", () => {
      this.bookmarksTabEl.addClass("is-active");
      this.historyTabEl.removeClass("is-active");
      this.renderList("bookmarks");
    });
    this.historyTabEl.addEventListener("click", () => {
      this.historyTabEl.addClass("is-active");
      this.bookmarksTabEl.removeClass("is-active");
      this.renderList("history");
    });

    const toolbar = root.createDiv({ cls: "mwv-toolbar" });
    this.makeToolButton(toolbar, "arrow-left", "Back", () => this.goBack());
    this.makeToolButton(toolbar, "arrow-right", "Forward", () => this.goForward());
    this.makeToolButton(toolbar, "rotate-cw", "Reload", () => this.reload());
    this.makeToolButton(toolbar, "home", "Home", () => this.navigate(this.plugin.settings.homeUrl, true));
    this.makeToolButton(toolbar, "star", "Bookmark", () => this.toggleBookmark());
    this.makeToolButton(toolbar, "book-open", "Bookmarks", () => this.openDrawer("bookmarks"));
    this.makeToolButton(toolbar, "history", "History", () => this.openDrawer("history"));
    this.makeToolButton(toolbar, "plus-square", "Save link", () => this.captureLink());
    this.makeToolButton(toolbar, "external-link", "Open externally", () => this.openExternal());
    this.makeToolButton(toolbar, "wand-sparkles", "NoteDraw", () => this.triggerNoteDraw());
    this.makeToolButton(toolbar, "settings", "Settings", () => this.plugin.openSettings());

    this.renderList("bookmarks");
  }

  makeToolButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): void {
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
    button.addEventListener("click", onClick);
  }

  renderList(kind: "bookmarks" | "history"): void {
    if (!this.listEl) return;
    this.listEl.empty();
    const entries = kind === "bookmarks" ? this.plugin.settings.bookmarks : this.plugin.settings.history;
    if (!entries.length) {
      this.listEl.createDiv({ cls: "mwv-empty", text: kind === "bookmarks" ? "No bookmarks yet" : "No history yet" });
      return;
    }

    for (const entry of entries.slice(0, 12)) {
      const item = this.listEl.createEl("button", { cls: "mwv-list-item", attr: { type: "button" } });
      item.createDiv({ cls: "mwv-list-title", text: entry.title || hostName(entry.url) });
      item.createDiv({ cls: "mwv-list-url", text: entry.url });
      item.addEventListener("click", () => this.navigate(entry.url, true));
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

    const quick = article.createDiv({ cls: "mwv-home-quick" });
    for (const entry of this.plugin.settings.bookmarks.slice(0, 6)) {
      const item = quick.createEl("button", { cls: "mwv-home-chip", attr: { type: "button" } });
      item.createSpan({ text: entry.title || hostName(entry.url) });
      item.addEventListener("click", () => this.navigate(entry.url, true));
    }

    if (results.length) {
      const list = article.createDiv({ cls: "mwv-results" });
      for (const result of results) {
        const item = list.createEl("button", { cls: "mwv-result", attr: { type: "button" } });
        item.createDiv({ cls: "mwv-result-title", text: result.title });
        item.createDiv({ cls: "mwv-result-url", text: result.url });
        if (result.snippet) item.createDiv({ cls: "mwv-result-snippet", text: result.snippet });
        item.addEventListener("click", () => this.navigate(result.url, true));
      }
    }
  }

  openDrawer(kind: "bookmarks" | "history"): void {
    this.drawerEl.addClass("is-open");
    if (kind === "bookmarks") {
      this.bookmarksTabEl.addClass("is-active");
      this.historyTabEl.removeClass("is-active");
    } else {
      this.historyTabEl.addClass("is-active");
      this.bookmarksTabEl.removeClass("is-active");
    }
    this.renderList(kind);
  }

  closeDrawer(): void {
    this.drawerEl.removeClass("is-open");
  }

  navigate(url: string, pushHistory: boolean): void {
    const nextUrl = normalizeInput(url, this.plugin.settings.searchUrl);
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
    void this.plugin.addHistory({
      title: this.currentTitle,
      url: nextUrl,
      time: Date.now()
    });
  }

  goBack(): void {
    const previous = this.backStack.pop();
    if (!previous) {
      new Notice("No previous page");
      return;
    }
    if (this.currentUrl) this.forwardStack.push(this.currentUrl);
    this.navigateWithoutStack(previous);
  }

  goForward(): void {
    const next = this.forwardStack.pop();
    if (!next) {
      new Notice("No next page");
      return;
    }
    if (this.currentUrl) this.backStack.push(this.currentUrl);
    this.navigateWithoutStack(next);
  }

  navigateWithoutStack(url: string): void {
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
    void this.plugin.addHistory({
      title: this.currentTitle,
      url,
      time: Date.now()
    });
  }

  reload(): void {
    if (!this.currentUrl) return;
    const query = this.extractBingQuery(this.currentUrl);
    if (this.isBingHome(this.currentUrl) || query !== null) {
      if (query) {
        this.searchBing(query, this.currentUrl);
      } else {
        this.showNativeHome(this.currentUrl);
      }
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
    this.currentUrl = url;
    this.currentTitle = "Bing";
    this.addressEl.value = url;
    this.titleEl.setText("Bing");
    this.subtitleEl.setText("Native light home");
    this.iframeEl.addClass("is-hidden");
    this.homeEl.addClass("is-visible");
    this.buildHome();
    void this.plugin.addHistory({
      title: "Bing",
      url,
      time: Date.now()
    });
  }

  async searchBing(query: string, url?: string): Promise<void> {
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
    this.iframeEl.addClass("is-hidden");
    this.homeEl.addClass("is-visible");
    this.buildHome(cleanQuery, []);

    try {
      const results = await this.plugin.searchBing(cleanQuery);
      this.subtitleEl.setText(`${results.length} result(s)`);
      this.buildHome(cleanQuery, results);
    } catch (error) {
      console.error("[mobile-webviewer] Bing search failed", error);
      this.subtitleEl.setText("Search failed");
      this.buildHome(cleanQuery, [
        {
          title: "Open Bing externally",
          url: searchUrl,
          snippet: "Embedded Bing is blocked on mobile. Open the full result page externally."
        }
      ]);
      new Notice("Bing result fetch failed. Use external open.");
    }

    void this.plugin.addHistory({
      title: this.currentTitle,
      url: searchUrl,
      time: Date.now()
    });
  }

  async renderUrlAsNote(url: string): Promise<void> {
    this.iframeEl.src = url;
    this.iframeEl.addClass("is-hidden");
    this.homeEl.addClass("is-visible");
    this.renderLoadingNote(url);

    try {
      const page = await this.plugin.fetchNotePage(url);
      this.currentTitle = page.title || hostName(url);
      this.titleEl.setText(this.currentTitle);
      this.subtitleEl.setText(page.byline || hostName(url));
      this.renderNotePage(page);
    } catch (error) {
      console.error("[mobile-webviewer] note render failed", error);
      this.subtitleEl.setText("Note render fallback");
      this.renderErrorNote(url);
    }
  }

  renderLoadingNote(url: string): void {
    this.homeEl.empty();
    const article = this.homeEl.createEl("article", { cls: "mwv-note-surface" });
    article.createDiv({ cls: "mwv-note-source", text: hostName(url) });
    article.createEl("h1", { text: "Loading page..." });
    article.createEl("p", { text: url });
  }

  renderErrorNote(url: string): void {
    this.iframeEl.addClass("is-hidden");
    this.homeEl.addClass("is-visible");
    this.homeEl.empty();
    const article = this.homeEl.createEl("article", { cls: "mwv-note-surface" });
    article.createDiv({ cls: "mwv-note-source", text: hostName(url) });
    article.createEl("h1", { text: "网页已在后台加载" });
    article.createEl("p", {
      text: "前端保持为虚拟 Markdown note。当前页面无法提取为笔记内容时，可复制链接或用系统浏览器打开。"
    });
    const actions = article.createDiv({ cls: "mwv-note-actions" });
    const openButton = actions.createEl("button", { text: "Open original", attr: { type: "button" } });
    openButton.addEventListener("click", () => window.open(url, "_blank"));
    const copyButton = actions.createEl("button", { text: "Copy link", attr: { type: "button" } });
    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(url);
      new Notice("Copied link");
    });
  }

  renderNotePage(page: NotePage): void {
    this.homeEl.empty();
    const article = this.homeEl.createEl("article", { cls: "mwv-note-surface" });
    article.createDiv({ cls: "mwv-note-source", text: page.byline || hostName(page.url) });
    article.createEl("h1", { text: page.title || hostName(page.url) });

    const actions = article.createDiv({ cls: "mwv-note-actions" });
    const openButton = actions.createEl("button", { text: "Open original", attr: { type: "button" } });
    openButton.addEventListener("click", () => window.open(page.url, "_blank"));
    const copyButton = actions.createEl("button", { text: "Copy link", attr: { type: "button" } });
    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(`[${page.title}](${page.url})`);
      new Notice("Copied link");
    });

    const content = article.createDiv({ cls: "mwv-note-content" });
    const blocks = page.content.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    if (!blocks.length) {
      content.createEl("p", { text: "No readable text was found. Open the original page if needed." });
    }
    for (const block of blocks.slice(0, 80)) {
      if (/^#{1,3}\s+/.test(block)) {
        const level = Math.min(3, block.match(/^#+/)?.[0].length ?? 2);
        content.createEl(`h${level}` as keyof HTMLElementTagNameMap, { text: block.replace(/^#{1,3}\s+/, "") });
      } else {
        content.createEl("p", { text: block });
      }
    }

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
  }

  async toggleBookmark(): Promise<void> {
    if (!this.currentUrl) return;
    const exists = this.plugin.settings.bookmarks.some((entry) => entry.url === this.currentUrl);
    if (exists) {
      this.plugin.settings.bookmarks = this.plugin.settings.bookmarks.filter((entry) => entry.url !== this.currentUrl);
      new Notice("Bookmark removed");
    } else {
      this.plugin.settings.bookmarks.unshift({
        title: this.currentTitle || hostName(this.currentUrl),
        url: this.currentUrl,
        time: Date.now()
      });
      this.plugin.settings.bookmarks = uniqueEntries(this.plugin.settings.bookmarks, MAX_BOOKMARKS);
      new Notice("Bookmark added");
    }
    await this.plugin.saveSettings();
    this.renderList("bookmarks");
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

  openExternal(): void {
    if (!this.currentUrl) return;
    window.open(this.currentUrl, "_blank");
  }

  triggerNoteDraw(): void {
    const pluginRegistry = (this.app as App & {
      plugins?: { plugins?: Record<string, unknown> };
      commands?: { executeCommandById?: (id: string) => boolean };
    });
    const notedraw = pluginRegistry.plugins?.plugins?.notedraw;

    if (!notedraw) {
      new Notice("NoteDraw plugin is not enabled.");
      return;
    }

    const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
    const targetLeaf = markdownLeaves.find((leaf) => leaf.view?.containerEl?.isConnected) ?? markdownLeaves[0];
    if (!targetLeaf) {
      new Notice("Open a note first, then use NoteDraw.");
      return;
    }

    this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
    window.setTimeout(() => {
      const ran = pluginRegistry.commands?.executeCommandById?.("notedraw:toggle");
      if (!ran) {
        const activeDoc = this.app.workspace.containerEl.ownerDocument;
        const button = activeDoc.querySelector<HTMLElement>(".workspace-leaf.mod-active .notedraw-header-button");
        if (button) {
          button.click();
        } else {
          new Notice("NoteDraw is not ready on this note.");
        }
      }
    }, 80);
  }

  openUrl(url: string): void {
    this.navigate(url, true);
  }
}

export default class MobileWebviewerPlugin extends Plugin {
  settings: MobileWebviewerSettings = DEFAULT_SETTINGS;
  processorSeq = 0;

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

    this.addRibbonIcon("smartphone", "Mobile Webviewer", () => {
      void this.openNoteBrowser();
    });

    this.addCommand({
      id: "open-note-browser",
      name: "Mobile Webviewer: Open Note Browser",
      callback: () => void this.openNoteBrowser()
    });

    this.addCommand({
      id: "open-browser-view",
      name: "Mobile Webviewer: Open Browser View",
      callback: () => void this.activateBrowserView()
    });

    this.addCommand({
      id: "open-url-in-mobile-webviewer",
      name: "Mobile Webviewer: Open URL in Note Browser",
      callback: async () => {
        const selected = this.app.workspace.activeEditor?.editor?.getSelection() ?? "";
        await this.openNoteBrowser(selected || this.settings.homeUrl);
      }
    });

    this.addCommand({
      id: "open-url-in-browser-view",
      name: "Mobile Webviewer: Open URL in Browser View",
      callback: async () => {
        const selected = this.app.workspace.activeEditor?.editor?.getSelection() ?? "";
        await this.activateBrowserView(selected || this.settings.homeUrl);
      }
    });

    this.addCommand({
      id: "open-home-in-mobile-webviewer",
      name: "Mobile Webviewer: Open Note Browser Home",
      callback: () => void this.openNoteBrowser(this.settings.homeUrl)
    });

    this.registerObsidianProtocolHandler("mobile-webviewer", async (params) => {
      const url = typeof params.url === "string" ? params.url : this.settings.homeUrl;
      await this.openNoteBrowser(url);
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
    });
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async activateBrowserView(url?: string): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (url && view instanceof MobileWebviewerView) {
      view.openUrl(url);
    }
  }

  async openNoteBrowser(input = this.settings.homeUrl): Promise<void> {
    const file = await this.ensureWebviewerNote();
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    if (input && input !== this.settings.homeUrl) {
      new Notice("Use the Mobile Webviewer search box inside the note.");
    }
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
      "  <div class=\"mwv-bing-shortcuts\">",
      "    <a href=\"https://www.bing.com/\">Bing</a>",
      "    <a href=\"https://www.wikipedia.org/\">Wikipedia</a>",
      "    <a href=\"https://cn.bing.com/search?q=Obsidian\">Obsidian</a>",
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
      const url = embed.dataset.url ?? this.settings.homeUrl;
      void this.renderEmbed(embed, url);
    }
  }

  async handleGlobalBingEvent(event: Event): Promise<void> {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const isClickSubmit =
      event.type === "click" &&
      Boolean(target.closest?.(".mwv-bing-submit"));
    const isEnterInput =
      event.type === "keydown" &&
      (event as KeyboardEvent).key === "Enter" &&
      Boolean(target.closest?.(".mwv-bing-input"));

    if (!isClickSubmit && !isEnterInput) return;

    const embed = target.closest<HTMLElement>(".mwv-embed.mwv-bing-home");
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
    embed.dataset.url = searchUrl;
    resultHost.empty();
    resultHost.createDiv({ cls: "mwv-bing-status", text: "Searching..." });

    try {
      const results = await this.searchBing(query);
      resultHost.empty();
      resultHost.createEl("h2", { text: `Search: ${query}` });
      for (const result of results) {
        const item = resultHost.createEl("button", { cls: "mwv-bing-result", attr: { type: "button" } });
        item.createDiv({ cls: "mwv-bing-result-title", text: result.title });
        item.createDiv({ cls: "mwv-bing-result-url", text: result.url });
        if (result.snippet) item.createDiv({ cls: "mwv-bing-result-snippet", text: result.snippet });
        item.addEventListener("click", () => void this.openNoteBrowser(result.url));
      }
    } catch (error) {
      console.error("[mobile-webviewer] Bing home search failed", error);
      resultHost.empty();
      resultHost.createEl("h2", { text: `Search: ${query}` });
      for (const result of fallbackSearchResults(query)) {
        const item = resultHost.createEl("button", { cls: "mwv-bing-result", attr: { type: "button" } });
        item.createDiv({ cls: "mwv-bing-result-title", text: result.title });
        item.createDiv({ cls: "mwv-bing-result-url", text: result.url });
        item.createDiv({ cls: "mwv-bing-result-snippet", text: result.snippet });
        item.addEventListener("click", () => window.open(result.url, "_blank"));
      }
    }
  }

  async renderEmbed(embed: HTMLElement, url: string): Promise<void> {
    const query = this.extractBingQuery(url);
    if (this.isBingHome(url) || query !== null) {
      this.renderBingShellEmbed(embed, query ?? "");
      return;
    }

    embed.empty();
    embed.addClass("mwv-note-embed");
    embed.createDiv({ cls: "mwv-note-source", text: hostName(url) });
    embed.createEl("h2", { text: "Loading page..." });
    try {
      const page = await this.fetchNotePage(url);
      this.renderPageEmbed(embed, page);
    } catch (error) {
      console.error("[mobile-webviewer] render embed failed", error);
      embed.empty();
      embed.createDiv({ cls: "mwv-note-source", text: hostName(url) });
      embed.createEl("h2", { text: "网页已在后台加载" });
      embed.createEl("p", { text: "无法提取为笔记内容。可用下方按钮打开原网页。" });
      this.addEmbedActions(embed, url, hostName(url));
    }
  }

  renderBingShellEmbed(embed: HTMLElement, query = ""): void {
    embed.empty();
    embed.addClass("mwv-bing-home");
    embed.removeClass("mwv-note-embed");

    embed.createDiv({ cls: "mwv-bing-logo", text: "Bing" });
    const search = embed.createDiv({ cls: "mwv-bing-search", attr: { role: "search" } });
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

    const shortcuts = embed.createDiv({ cls: "mwv-bing-shortcuts" });
    for (const item of [
      ["Bing", "https://www.bing.com/"],
      ["Wikipedia", "https://www.wikipedia.org/"],
      ["Obsidian", "https://cn.bing.com/search?q=Obsidian"]
    ]) {
      shortcuts.createEl("a", { text: item[0], href: item[1] });
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
      await this.openNoteBrowser(next);
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
            const item = list.createEl("button", { cls: "mwv-md-result", attr: { type: "button" } });
            item.createDiv({ cls: "mwv-md-result-title", text: result.title });
            item.createDiv({ cls: "mwv-md-result-url", text: result.url });
            if (result.snippet) item.createDiv({ cls: "mwv-md-result-snippet", text: result.snippet });
            item.addEventListener("click", () => void this.openNoteBrowser(result.url));
          }
        })
        .catch(() => {
          list.empty();
          list.createEl("p", { text: "Search failed." });
        });
    }
  }

  renderPageEmbed(embed: HTMLElement, page: NotePage): void {
    embed.empty();
    embed.createDiv({ cls: "mwv-note-source", text: page.byline || hostName(page.url) });
    embed.createEl("h2", { text: page.title || hostName(page.url) });
    this.addEmbedActions(embed, page.url, page.title);
    const content = embed.createDiv({ cls: "mwv-md-content" });
    const blocks = page.content.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    for (const block of blocks.slice(0, 80)) {
      content.createEl("p", { text: block.replace(/^#{1,3}\s+/, "") });
    }
  }

  addEmbedActions(embed: HTMLElement, url: string, title: string): void {
    const actions = embed.createDiv({ cls: "mwv-note-actions" });
    const open = actions.createEl("button", { text: "Open original", attr: { type: "button" } });
    open.addEventListener("click", () => window.open(url, "_blank"));
    const copy = actions.createEl("button", { text: "Copy link", attr: { type: "button" } });
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(`[${title}](${url})`);
      new Notice("Copied link");
    });
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

  async addHistory(entry: WebEntry): Promise<void> {
    this.settings.history.unshift(entry);
    this.settings.history = uniqueEntries(this.settings.history, MAX_HISTORY);
    await this.saveSettings();
  }

  async openFirstLinkInFile(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const match = content.match(/https?:\/\/[^\s)\]]+/);
    if (!match) {
      new Notice("No web link found");
      return;
    }
    await this.openNoteBrowser(match[0]);
  }

  async searchBing(query: string): Promise<SearchResult[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];

    const url = DEFAULT_SEARCH.replace("{{query}}", encodeURIComponent(cleanQuery));
    const rssUrl = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(cleanQuery)}`;
    const parser = new DOMParser();

    try {
      const response = await requestUrl({
        url,
        method: "GET",
        headers: {
          "Accept": "text/html,application/xhtml+xml"
        }
      });

      const doc = parser.parseFromString(response.text, "text/html");
      const items = Array.from(doc.querySelectorAll("li.b_algo, .b_algo")).slice(0, 10);
      const results: SearchResult[] = [];
      const seen = new Set<string>();

      for (const item of items) {
        const anchor = item.querySelector<HTMLAnchorElement>("h2 a, a");
        if (!anchor?.href) continue;
        const title = anchor.textContent?.trim() || anchor.href;
        const resultUrl = cleanResultUrl(anchor.href);
        if (!resultUrl || seen.has(resultUrl)) continue;
        seen.add(resultUrl);
        const snippet = item.querySelector(".b_caption p, p")?.textContent?.trim() || "";
        results.push({
          title,
          url: resultUrl,
          snippet
        });
      }

      if (results.length) return results;
    } catch (error) {
      console.warn("[mobile-webviewer] Bing HTML search failed; trying RSS fallback", error);
    }

    try {
      const response = await requestUrl({
        url: rssUrl,
        method: "GET",
        headers: {
          "Accept": "application/rss+xml,application/xml,text/xml"
        }
      });

      const doc = parser.parseFromString(response.text, "application/xml");
      const items = Array.from(doc.querySelectorAll("item")).slice(0, 10);
      const results: SearchResult[] = [];
      const seen = new Set<string>();

      for (const item of items) {
        const title = textFromElement(item.querySelector("title"));
        const link = textFromElement(item.querySelector("link"));
        if (!title || !/^https?:\/\//i.test(link) || seen.has(link)) continue;
        seen.add(link);
        results.push({
          title,
          url: cleanResultUrl(link),
          snippet: htmlToText(textFromElement(item.querySelector("description")))
        });
      }

      if (results.length) return results;
    } catch (error) {
      console.warn("[mobile-webviewer] Bing RSS search failed; using external fallback", error);
    }

    return fallbackSearchResults(cleanQuery);
  }

  async fetchNotePage(url: string): Promise<NotePage> {
    const response = await requestUrl({
      url,
      method: "GET",
      headers: {
        "Accept": "text/html,application/xhtml+xml"
      }
    });

    const parser = new DOMParser();
    const doc = parser.parseFromString(response.text, "text/html");
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

    return {
      title,
      url,
      byline,
      content: blocks.join("\n\n"),
      links
    };
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
    this.settings.bookmarks = Array.isArray(this.settings.bookmarks) ? this.settings.bookmarks : [];
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class MobileWebviewerSettingTab extends PluginSettingTab {
  plugin: MobileWebviewerPlugin;

  constructor(app: App, plugin: MobileWebviewerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("mwv-settings");

    containerEl.createEl("h2", { text: "Mobile Webviewer" });

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
  }
}
