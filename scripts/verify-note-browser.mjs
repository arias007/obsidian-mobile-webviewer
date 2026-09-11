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
const modeStart = source.indexOf("\n  setNoteBrowserEmbedMode(");
const modeEnd = source.indexOf("\n  canNavigateEmbed(", modeStart);
const modeMethod = modeStart >= 0 && modeEnd > modeStart ? source.slice(modeStart, modeEnd) : "";
const bridgeStart = source.indexOf("\n  installWebviewBrowserBridge(");
const bridgeEnd = source.indexOf("\n  extractInternalDownloadUrl(", bridgeStart);
const bridgeMethod = bridgeStart >= 0 && bridgeEnd > bridgeStart ? source.slice(bridgeStart, bridgeEnd) : "";
const ownershipStart = source.indexOf("\n  isNoteBrowserLeaf(");
const ownershipEnd = source.indexOf("\n  findWorkspaceLeafForElement(", ownershipStart);
const ownershipMethods = ownershipStart >= 0 && ownershipEnd > ownershipStart ? source.slice(ownershipStart, ownershipEnd) : "";
const cleanupStart = source.indexOf("\n  cleanupStaleNoteDrawButtonResidue(");
const cleanupEnd = source.indexOf("\n  ensureNoteDrawStableAnchor(", cleanupStart);
const cleanupMethod = cleanupStart >= 0 && cleanupEnd > cleanupStart ? source.slice(cleanupStart, cleanupEnd) : "";
const observerStart = source.indexOf("\n  installNoteDrawDedupeObserver(");
const observerEnd = source.indexOf("\n  queueNoteDrawButtonDedupe(", observerStart);
const observerMethod = observerStart >= 0 && observerEnd > observerStart ? source.slice(observerStart, observerEnd) : "";
const bindingStart = source.indexOf("\n  refreshNoteDrawWorkspaceBinding(");
const bindingEnd = source.indexOf("\n  notifyNoteDrawWebviewChanged(", bindingStart);
const bindingMethod = bindingStart >= 0 && bindingEnd > bindingStart ? source.slice(bindingStart, bindingEnd) : "";

const checks = [
  ["standalone results use the available workspace width", styles.includes('.workspace-leaf-content[data-type="mobile-webviewer-view"] .mwv-results') && styles.includes("max-width: none")],
  ["NoteWeb embeds opt out of Obsidian readable line width", source.includes("prepareWebviewerDocumentLayout(embed)") && styles.includes(".mwv-note-browser-document .markdown-preview-sizer")],
  ["fast reload rebuilds stale or incomplete NoteWeb toolbars", source.includes("processorSessionId") && source.includes('chrome?.querySelector(".mwv-browser-more")')],
  ["missing Markdown blocks recover the visible NoteWeb root", source.includes("restoreMissingNoteBrowserEmbed(root)") && source.includes('root.matches(\".markdown-preview-view\")') && source.includes('sizer.createDiv({ cls: \"el-div\" })')],
  ["late Markdown restoration cannot duplicate the NoteWeb root", source.includes("dedupeNoteBrowserEmbedRoots(root)") && source.includes('controller?.previewEl === embed') && source.includes('embed.dataset.mwvRecovered = \"true\"')],
  ["detached Electron webviews cannot throw from delayed events", source.includes("safeWebviewUrl(webview") && source.includes("isBrowserSurfaceReady(webview)") && source.includes("_mwvDispose") && source.includes('listen("destroyed"')],
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
  ["NoteWeb navigation normalizes equivalent trailing-slash URLs", source.includes("equivalentEmbedUrl") && source.includes("while (previous && equivalentEmbedUrl(previous, current))") && source.includes("while (next && equivalentEmbedUrl(next, current))")],
  ["NoteWeb keeps ordinary links in the current note", source.includes('await this.openUrlInEmbed(embed, url)')],
  ["NoteWeb toolbar has stable two-row layout", styles.includes('"controls actions"') && styles.includes('"address address"') && styles.includes("grid-area: address") && styles.includes(".mwv-bing-home .mwv-bing-note-content button") && !styles.includes(".mwv-bing-home button,")],
  ["NoteWeb hides the duplicate in-content URL row", styles.includes(".mwv-note-browser-document .mwv-browser-address") && styles.includes("display: none") && styles.includes('grid-template-areas: "controls actions"')],
  ["NoteWeb result tabs and media stay borderless", styles.includes(".mwv-note-browser-document .mwv-bing-home .mwv-bing-tab") && styles.includes("border: 0 !important") && styles.includes(".mwv-note-browser-document .mwv-page-media img")],
  ["NoteWeb real-web mode renders the original page including the home URL", source.includes('(mode === "web" || mode === "split") && !embed.querySelector(":scope > .mwv-live-browser")') && source.includes("this.renderLiveBrowserSurface(embed, liveUrl)") && source.includes('cls: "mwv-bing-note-content"') && styles.includes(".mwv-bing-home.is-web-front > .mwv-bing-note-content")],
  ["NoteWeb creates at most one direct live browser surface", source.includes("Array.from(embed.children)") && source.includes("existing.slice(1)") && source.includes("querySelector(\":scope > .mwv-live-frame\")")],
  ["Note/Web switching retains one live page without navigation or URL assignment", modeMethod.includes("retainedSurface") && modeMethod.includes("currentSurface !== retainedSurface") && !modeMethod.includes("openUrlInEmbed") && !modeMethod.includes("renderEmbed(") && !modeMethod.includes("loadURL") && !modeMethod.includes(".src =")],
  ["NoteWeb keeps the real page usable with active NoteDraw controls", styles.includes("display: flex") && styles.includes("flex: 1 1 auto") && !styles.includes("--mwv-web-safe-top")],
  ["NoteWeb hides duplicate chrome after a Markdown preview rebuild", styles.includes(":has(.mwv-embed[data-url]) .mwv-browser-chrome") && source.includes("markdown-preview-sizer")],
  ["NoteWeb double-clicks cannot switch Obsidian into edit mode", source.includes('["mousedown", "click", "dblclick"]') && doubleActivationMethod.includes("event.detail < 2") && doubleActivationMethod.includes("event.stopImmediatePropagation()") && doubleActivationMethod.includes("file.path !== WEBVIEW_NOTE_PATH")],
  ["NoteWeb double-click containment preserves native text selection", !doubleActivationMethod.includes("event.preventDefault")],
  ["NoteWeb ownership is resolved from the exact Mobile Webviewer leaf", ownershipMethods.includes("isNoteBrowserLeaf") && ownershipMethods.includes("file.path === WEBVIEW_NOTE_PATH") && ownershipMethods.includes("findWorkspaceLeafForElement(element)")],
  ["ordinary Markdown leaves are skipped before any NoteDraw residue cleanup", cleanupMethod.includes("const noteWebLeaf = this.isNoteBrowserLeaf(workspaceLeaf);") && cleanupMethod.includes("const hasMwvResidue =") && cleanupMethod.includes("if (!noteWebLeaf && !hasMwvResidue) continue;") && cleanupMethod.indexOf("if (!noteWebLeaf && !hasMwvResidue) continue;") < cleanupMethod.indexOf("button.removeClass(\"notedraw-webview-button\")") && cleanupMethod.indexOf("if (!noteWebLeaf && !hasMwvResidue) continue;") < cleanupMethod.indexOf("leaf.removeClass(\"mwv-notedraw-surface-leaf\")")],
  ["global NoteDraw observer ignores mutations outside the NoteWeb leaf", observerMethod.includes("if (!this.isNoteWebOwnedElement(root)) continue;") && !observerMethod.includes("cleanupStaleNoteDrawButtonResidue")],
  ["NoteWeb refresh never triggers global ordinary-note NoteDraw source/header passes", bindingMethod.includes("if (!root?.isConnected || !this.isNoteWebOwnedElement(root)) return;") && !bindingMethod.includes("syncSourceControllers") && !bindingMethod.includes("syncMobileWebviewerHeaderButtons") && !bindingMethod.includes('workspace.trigger?.("layout-change")')],
  ["NoteDraw controller discovery cannot fall back to another leaf", source.includes("if (!this.noteDrawControllerBelongsToRoot(controller, root)) return;") && source.includes("if (!root?.isConnected || !this.isNoteWebOwnedElement(root)) return [];")],
  ["NoteWeb blocks source mode at the view-state boundary", source.includes("guardedSetState") && source.includes('state.mode === "source" || state.source === true') && source.includes('file.path === WEBVIEW_NOTE_PATH') && (source.includes('binding.view.setState === binding.guardedSetState') || source.includes('view.setState === binding.guardedSetState'))],
  ["NoteWeb also recovers from unexpected source mode", source.includes("this.enforceNoteBrowserReadingMode();") && source.includes("enforceNoteBrowserReadingMode(): void") && source.includes('state.mode !== "preview" || state.source !== false') && source.includes("applyReadingMode();")],
  ["NoteWeb Markdown controls are fused into Obsidian native actions and pane menu", source.includes("syncNoteBrowserNativeActions") && source.includes("view.addAction") && source.includes("view.onPaneMenu") && source.includes("view-header-nav-buttons") && source.includes("mwv-note-browser-native-nav") && source.includes("event.stopPropagation()") && styles.includes(".mwv-note-browser-document .mwv-browser-chrome") && styles.includes("display: none !important")],
  ["NoteWeb replaces the Obsidian edit toggle with Note/Web mode", source.includes("mwv-note-browser-mode-action") && source.includes("mwv-note-browser-replaced-edit-action") && styles.includes(".mwv-note-browser-replaced-edit-action") && !source.includes('addNativeAction("arrow-left"') && !source.includes('addNativeAction("arrow-right"')],
  ["NoteWeb wand opens NoteDraw in element selection mode", source.includes("setNoteDrawWebviewTool(controller, \"select\")") && source.includes("setToolFromApi") && source.includes("controller.toolMode === \"edit-md\"")],
  ["NoteWeb search results omit the recommendation column", !source.includes('side.createEl("h3"') && !source.includes('cls: "mwv-related-pill"') && styles.includes(".mwv-bing-serp") && styles.includes("grid-template-columns: minmax(0, 1fr)")],
  ["NoteWeb Web mode fills the actual Markdown viewport", styles.includes(":has(.mwv-embed.is-web-front) > .markdown-preview-sizer") && styles.includes("min-height: 0 !important") && styles.includes("padding-bottom: 0 !important") && styles.includes(".el-div:has(> .mwv-embed.is-web-front)") && styles.includes("height: 100%") && !styles.includes("height: max(480px, 68vh)")],
  ["NoteWeb deepest live webview remains unscaled and fills its flex surface", styles.includes(".mwv-bing-home.is-web-front > .mwv-live-browser > .mwv-real-webview") && styles.includes("display: flex") && styles.includes("flex: 1 1 auto") && styles.includes("min-height: 0") && source.includes('frame.setCssStyles({ zoom: "1" })')],
  ["real webpages stay raw after delayed WebView callbacks", source.includes("isRawRealWebview") && source.includes("isRawRealBrowserSurface") && source.includes("if (this.isRawRealWebview(webview)) return;") && source.includes("if (this.isRawRealBrowserSurface(frame)) return;") && source.includes("const rawWebview = this.isRawRealBrowserSurface(frame)") && source.includes("frame.setZoomFactor?.(rawWebview ? 1 : zoom / 100)") && styles.includes("filter: none !important") && styles.includes("transform: none !important")],
  ["raw WebView surfaces opt out of every guest-page injection path", source.includes("raw?: boolean") && source.includes("raw: true") && source.includes("const keepGuestUntouched = callbacks.raw === true") && source.includes("if (!keepGuestUntouched)") && source.includes("mwv-raw-surface")],
  ["WebView navigation APIs wait for dom-ready", source.includes("isBrowserSurfaceReady") && source.includes("_mwvReady") && source.includes("setBrowserSurfaceUrl") && source.includes("navigateEmbedBack") && source.includes("navigateEmbedForward")],
  ["destroyed WebViews release every registered listener", source.includes("_mwvDispose") && source.includes('listen("destroyed"') && source.includes("removeEventListener") && source.includes("disposeBrowserSurfacesIn")],
  ["raw WebView ignores subframe failures", source.includes("isMainFrame?: boolean") && source.includes("if (detail.isMainFrame === false) return;")],
  ["raw Web mode does not fall back to reader after a delayed load error", source.includes('if (this.frontendMode === "web" && this.plugin.isRawRealBrowserSurface(this.surfaceEl)) return;') && source.includes('if (embed.hasClass("is-web-front")) return;')],
  ["standalone Web mode is a single stable WebView without delayed NoteDraw mounting", source.includes("is-raw-web") && styles.includes(".mwv-root.is-raw-web .mwv-home") && styles.includes(".mwv-root.is-raw-web .notedraw-canvas") && styles.includes("position: absolute") && source.includes("void forceEditMode") && !source.includes("this.plugin.notifyNoteDrawWebviewChanged(root, shouldForceEdit)")],
  ["NoteWeb Web mode hides retained NoteDraw canvases and layers", styles.includes(".mwv-embed.is-web-front") && styles.includes(".notedraw-static-canvas") && styles.includes(".notedraw-embed-layer") && styles.includes("display: none !important") && styles.includes("pointer-events: none !important")],
  ["Web-to-Note mode switch restores the current NoteDraw toolbar", modeMethod.includes("cleanupStaleNoteDrawButtonResidue(leafContent)") && modeMethod.includes("refreshNoteDrawWorkspaceBinding(embed, true, false)") && modeMethod.includes("queueNoteDrawControllerSync(embed, true)")],
  ["NoteDraw hidden markers are scoped to Web mode", cleanupMethod.includes("hasMobileWebviewerWebMode") && cleanupMethod.includes("if (hasMobileWebviewerWebMode && button.hasClass(\"mwv-notedraw-webviewer-header-hidden\"))") && cleanupMethod.includes("!hasMobileWebviewerSurface && button.hasClass(\"mwv-notedraw-webviewer-header-hidden\")")],
  ["NoteWeb reapplies raw-surface isolation after delayed NoteDraw mutations", source.includes("applyNoteBrowserWebIsolation") && source.includes("mwvRawWebHiddenStyle") && source.includes("mutationRoot") && source.includes("isNoteBrowserWebMode(mutationRoot)")],
  ["switching away from NoteWeb sweeps stale markers from every ordinary leaf", source.includes('this.app.workspace.on("active-leaf-change"') && source.includes("cleanupNoteBrowserDocumentResidue(this.app.workspace.containerEl)") && source.includes("isStillNoteBrowser")],
  ["NoteWeb never installs the legacy T A pen layer into the real page", bridgeMethod.includes("cleanupLegacyWebNoteOverlay") && bridgeMethod.includes('doc.getElementById("mwv-page-note-root")?.remove()') && !bridgeMethod.includes("installWebNoteOverlay();")],
  ["NoteWeb never replaces a live page with cached page HTML", !source.includes("doc.body.innerHTML = payload.pageHtml") && !source.includes("this.hydrateWebviewPageNote(")],
  ["NoteWeb does not let NoteDraw virtual height resize the real web page", source.includes('root.matches(".mwv-embed.is-web-front, .mwv-note-embed.is-web-front, .mwv-bing-home.is-web-front")')],
  ["raw Web surfaces are hard-excluded before NoteDraw mounts a controller", source.includes("installNoteDrawRawSurfaceGuard") && source.includes("isRawNoteDrawExcludedSurface") && source.includes("noteDrawRawSurfaceGuardRunning") && source.includes("Object.defineProperty(documentEl, \"querySelectorAll\"")],
  ["raw Web mode destroys controller-owned body floating controls", source.includes("disposeNoteDrawControllersForRawSurface") && source.includes("notedraw-body-control") && source.includes("documentEl.body?.querySelectorAll") && modeMethod.includes("disposeNoteDrawControllersForRawSurface(embed)")],
  ["standalone Web to NoteWeb transition clears all raw NoteDraw controllers", source.includes("disposeAllRawNoteDrawControllers") && source.includes("this.plugin.disposeAllRawNoteDrawControllers()")],
  ["raw isolation is explicitly marked on the standalone root", source.includes('toggleAttribute("data-notedraw-ignore"') && source.includes('removeAttribute("data-notedraw-ignore"')],
  ["leaving NoteWeb restores the reused Markdown leaf's native toolbar and navigation", source.includes("restoreNoteBrowserNativeBinding") && source.includes("restoreStaleNoteBrowserNativeBindings") && source.includes("noteBrowserNativeBindings.delete(leaf)") && source.includes("mwv-note-browser-native-nav")],
  ["raw iframe surfaces never inherit page zoom or desktop width", source.includes('frame.setCssStyles({ zoom: rawWebview ? "1" : `${zoom}%` })') && source.includes('frame.toggleClass("mwv-desktop-frame", !rawWebview && this.settings.desktopMode)')],
  ["raw NoteWeb clears host runtime presentation classes", source.includes("runNoteDrawWithoutRawNoteWebLeaves") && source.includes("isRawNoteWebLeaf") && source.includes('root.removeClass("mwv-night-mode")') && source.includes('root.removeClass("mwv-rotated")')],
  ["NoteDraw Markdown sync skips raw NoteWeb leaves but preserves ordinary notes", source.includes("installNoteDrawMarkdownSyncGuards") && source.includes("syncRenderedMarkdownAnnotations") && source.includes("workspace.getLeavesOfType = guardedGetLeavesOfType") && source.includes("return leaves.filter((leaf) => !this.isRawNoteWebLeaf(leaf))")],
  ["ordinary Markdown cleanup removes stale NoteWeb webview controllers only", source.includes("staleWebviewControllers") && source.includes("hasMobileWebviewerMarker") && source.includes("controller.destroy?.()") && source.includes("if (!noteWebLeaf)")],
  ["NoteWeb ad filtering avoids broad selectors that hide normal page headers", source.includes("[id='ad' i]") && source.includes("[class~='ad' i]") && !source.includes("[id*='ad' i]") && !source.includes("[class*='ad-' i]") && !source.includes("[class*='ads' i]")],
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
