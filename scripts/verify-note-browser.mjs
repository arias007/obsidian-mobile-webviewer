import fs from "node:fs";

const source = fs.readFileSync("main.ts", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

const bindStart = source.indexOf("bindNoteDrawWebviewButton(");
const bindEnd = source.indexOf("\n  isMobileWebviewerSurface(", bindStart);
const bindMethod = bindStart >= 0 && bindEnd > bindStart ? source.slice(bindStart, bindEnd) : "";
const chromeStart = source.indexOf("renderBrowserChrome(");
const chromeEnd = source.indexOf("\n  watchEmbedChrome(", chromeStart);
const chromeMethod = chromeStart >= 0 && chromeEnd > chromeStart ? source.slice(chromeStart, chromeEnd) : "";
const doubleActivationStart = source.indexOf("\n  handleNoteBrowserDoubleActivation(");
const doubleActivationEnd = source.indexOf("\n  installNoteDrawDedupeObserver(", doubleActivationStart);
const doubleActivationMethod = doubleActivationStart >= 0 && doubleActivationEnd > doubleActivationStart
  ? source.slice(doubleActivationStart, doubleActivationEnd)
  : "";

const checks = [
  ["standalone results use the available workspace width", styles.includes('.workspace-leaf-content[data-type="mobile-webviewer-view"] .mwv-results') && styles.includes("max-width: none")],
  ["NoteWeb embeds opt out of Obsidian readable line width", source.includes("prepareWebviewerDocumentLayout(embed)") && styles.includes(".mwv-note-browser-document .markdown-preview-sizer")],
  ["fast reload rebuilds stale or incomplete NoteWeb toolbars", source.includes("processorSessionId") && source.includes('chrome?.querySelector(".mwv-browser-more")')],
  ["missing Markdown blocks recover the visible NoteWeb root", source.includes("restoreMissingNoteBrowserEmbed(root)") && source.includes('root.matches(\".markdown-preview-view\")') && source.includes('sizer.createDiv({ cls: \"el-div\" })')],
  ["late Markdown restoration cannot duplicate the NoteWeb root", source.includes("dedupeNoteBrowserEmbedRoots(root)") && source.includes('controller?.previewEl === embed') && source.includes('embed.dataset.mwvRecovered = \"true\"')],
  ["detached Electron webviews cannot throw from delayed events", source.includes("safeWebviewUrl(webview") && (source.match(/if \(!webview\.isConnected\) return;/g) ?? []).length >= 8],
  ["hidden Live Preview copies do not join NoteWeb processing", source.includes('sourceView = embed.closest<HTMLElement>(\".markdown-source-view\")') && source.includes('window.getComputedStyle(sourceView).display !== \"none\"')],
  ["NoteWeb removes redundant nested reading-view gutters", styles.includes(".markdown-preview-view.mwv-note-browser-document") && styles.includes("padding-right: 8px")],
  ["duplicate in-page Mobile Webviewer branding is removed", !source.includes("Mobile Webviewer / Bing backend") && !source.includes('cls: "mwv-note-source", text: "Mobile Webviewer"')],
  ["duplicate NoteWeb document headings are hidden without changing page titles", source.includes('title.textContent?.trim().toLowerCase() === "mobile webviewer"') && styles.includes(".mwv-note-browser-redundant-title") && styles.includes('h1[data-heading="Mobile Webviewer"]')],
  ["NoteWeb uses the URL as its native Obsidian identity", source.includes("syncNoteBrowserNativeIdentity") && source.includes('file.path !== WEBVIEW_NOTE_PATH') && source.includes("tabHeaderInnerTitleEl") && source.includes('title.setText(url)')],
  ["new NoteWeb notes omit the redundant heading", !source.includes('"# Mobile Webviewer"')],
  ["home and search pages expose their own URL identity", source.includes("article.dataset.url = this.currentUrl || this.plugin.settings.homeUrl")],
  ["page identity changes refresh the NoteDraw URL controller", source.includes("if (pageChanged) this.queueNoteDrawPageRefresh()")],
  ["rebuilt home and reader content restore NoteDraw state", (source.match(/this\.queueNoteDrawPageRefresh\(\);/g) ?? []).length >= 4],
  ["NoteWeb forwards wand hold and context actions to the current URL controller", bindMethod.includes('_mwvNoteDrawBoundController') && source.includes("handleNoteDrawWebWandLifecycle") && source.includes('? "onButtonPointerDown"') && source.includes('? "onButtonContextMenu"')],
  ["NoteWeb wand click mounts the current URL controller toolbar", bindMethod.includes('event.type === "click"') && bindMethod.includes("this.activateNoteDrawWebviewController(controller, controller.previewEl)") && source.includes("controller.plugin?.setInteractionController?.(controller)")],
  ["NoteWeb drawing controls stay above its browser chrome", styles.includes(".mwv-embed.notedraw-shell > .notedraw-toolbar") && styles.includes("z-index: 1300")],
  ["NoteWeb removes its internal tab strip and status row", !chromeMethod.includes('createDiv({ cls: "mwv-tab-strip mwv-embed-tab-strip"') && !chromeMethod.includes('createDiv({ cls: "mwv-browser-status"')],
  ["NoteWeb keeps its own more menu and current page identity", chromeMethod.includes('mwv-browser-more') && chromeMethod.includes("this.toggleMorePanel(embed, chrome, liveUrl, liveTitle)") && source.includes('more.dataset.mwvUrl = url')],
  ["NoteWeb uses Obsidian tabs for explicit new-window navigation", source.includes('event.type === "auxclick"') && source.includes('await this.openNoteBrowser(url, true)') && source.includes('onNewWindow: (nextUrl) => this.openNoteBrowser(nextUrl, true)') && source.includes("boundToLeaf") && source.includes("requestedUrl")],
  ["NoteWeb keeps ordinary links in the current note", source.includes('await this.openUrlInEmbed(embed, url)')],
  ["NoteWeb toolbar has stable two-row layout", styles.includes('"controls actions"') && styles.includes('"address address"') && styles.includes("grid-area: address") && styles.includes(".mwv-bing-home .mwv-bing-note-content button") && !styles.includes(".mwv-bing-home button,")],
  ["NoteWeb hides the duplicate in-content URL row", styles.includes(".mwv-note-browser-document .mwv-browser-address") && styles.includes("display: none") && styles.includes('grid-template-areas: "controls actions"')],
  ["NoteWeb result tabs and media stay borderless", styles.includes(".mwv-note-browser-document .mwv-bing-home .mwv-bing-tab") && styles.includes("border: 0 !important") && styles.includes(".mwv-note-browser-document .mwv-page-media img")],
  ["NoteWeb real-web mode renders the original page including the home URL", source.includes('mode === "web" && !embed.querySelector(":scope > .mwv-live-browser")') && source.includes("this.renderLiveBrowserSurface(embed, liveUrl)") && source.includes('cls: "mwv-bing-note-content"') && styles.includes(".mwv-bing-home.is-web-front > .mwv-bing-note-content")],
  ["NoteWeb keeps the real page below active NoteDraw controls", styles.includes("--mwv-web-safe-top") && styles.includes("notedraw-shell.is-drawing-active") && styles.includes("calc(100% - var(--mwv-web-safe-top))")],
  ["NoteWeb hides duplicate chrome after a Markdown preview rebuild", styles.includes(":has(.mwv-embed[data-url]) .mwv-browser-chrome") && source.includes("markdown-preview-sizer")],
  ["NoteWeb double-clicks cannot switch Obsidian into edit mode", source.includes('["mousedown", "click", "dblclick"]') && doubleActivationMethod.includes("event.detail < 2") && doubleActivationMethod.includes("event.stopImmediatePropagation()") && doubleActivationMethod.includes("file.path !== WEBVIEW_NOTE_PATH")],
  ["NoteWeb double-click containment preserves native text selection", !doubleActivationMethod.includes("event.preventDefault")],
  ["NoteWeb blocks source mode at the view-state boundary", source.includes("guardedSetState") && source.includes('state.mode === "source" || state.source === true') && source.includes('file.path === WEBVIEW_NOTE_PATH') && source.includes('binding.view.setState === binding.guardedSetState')],
  ["NoteWeb also recovers from unexpected source mode", source.includes("this.enforceNoteBrowserReadingMode();") && source.includes("enforceNoteBrowserReadingMode(): void") && source.includes('state.mode !== "preview" || state.source !== false') && source.includes("applyReadingMode();")],
  ["NoteWeb Markdown controls are fused into Obsidian native actions and pane menu", source.includes("syncNoteBrowserNativeActions") && source.includes("view.addAction") && source.includes("view.onPaneMenu") && source.includes("view-header-nav-buttons") && source.includes("mwv-note-browser-native-nav") && styles.includes(".mwv-note-browser-document .mwv-browser-chrome") && styles.includes("display: none !important")],
  ["NoteWeb replaces the Obsidian edit toggle with Note/Web mode", source.includes("mwv-note-browser-mode-action") && source.includes("mwv-note-browser-replaced-edit-action") && styles.includes(".mwv-note-browser-replaced-edit-action") && !source.includes('addNativeAction("arrow-left"') && !source.includes('addNativeAction("arrow-right"')],
  ["NoteWeb search results omit the recommendation column", !source.includes('side.createEl("h3"') && !source.includes('cls: "mwv-related-pill"') && styles.includes(".mwv-bing-serp") && styles.includes("grid-template-columns: minmax(0, 1fr)")],
  ["NoteWeb Web mode keeps a usable live surface height", styles.includes(".mwv-note-browser-document .mwv-bing-home.is-web-front > .mwv-live-browser") && styles.includes("height: max(480px, 68vh)") && styles.includes("min-height: 480px")],
  ["NoteWeb Markdown embeds lose their surrounding frame", styles.includes(".mwv-note-browser-document .mwv-bing-home") && styles.includes("border: 0") && styles.includes("border-radius: 0")],
  ["hidden browser tabs cannot leave visible NoteDraw wands", source.includes("if (!this.isVisibleNoteDrawSurface(surface))") && source.includes('button.setAttribute("aria-hidden", "true")')],
  ["stale NoteDraw controllers are rebuilt through NoteDraw itself", source.includes("repairStaleNoteDrawController") && source.includes("noteDrawPlugin?.syncWebviewControllers?.()")],
  ["programmatic wand activation prefers the webview controller", source.includes("this.activateNoteDrawWebviewController(webviewController, webviewController.previewEl)")],
  ["legacy whole-note drawings migrate once through the NoteDraw API", source.includes("NOTEDRAW_LEGACY_WEBVIEWER_MIGRATION_VERSION") && source.includes("noteDrawApi.writeDrawings(homeFile, migrated)") && source.includes("noteDrawApi.readDrawings(homeFile)")],
  ["legacy migration still queues after a fast plugin reload", source.includes("this.queueLegacyNoteDrawWebviewerMigration(preview)")],
  ["legacy migration starts immediately then waits for delayed controllers", source.includes("noteDrawLegacyMigrationRetry === 0") && source.includes("[800, 1600, 3200, 6000, 10000]")],
  ["homepage migration can resolve URL storage without a mounted surface", source.includes("noteDrawWebviewFileForUrl") && source.includes("Math.imul(hash, 16777619)")],
  ["legacy migration also starts from the retained NoteWeb document", (source.match(/querySelectorAll<HTMLElement>\(\"\.mwv-note-browser-document\"\)/g) ?? []).length >= 2],
  ["cross-surface migration rebases stale note anchors", source.includes("rebaseLegacyNoteDrawStroke") && source.includes(".path = targetPath") && source.includes("noteDrawDataHasForeignAnchors")],
  ["legacy whole-note canvas hides only after verified migration", source.includes("verifiedCounts.strokes !== legacyCounts.strokes") && styles.includes(".mwv-note-browser-document.mwv-notedraw-legacy-migrated > .notedraw-static-canvas")],
  ["legacy drawing storage remains as recovery data", !source.includes("delete(legacyController.file") && !source.includes("remove(legacyController.file")]
];

const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);

if (failed.length) {
  console.error(`Note browser verification failed: ${failed.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`Note browser verification passed (${checks.length}/${checks.length}).`);
}
