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
const wandStart = source.indexOf("\n  ensureNoteWebWandProxy(");
const wandEnd = source.indexOf("\n  async toggleNoteWebRawElementEditing(", wandStart);
const wandMethod = wandStart >= 0 && wandEnd > wandStart ? source.slice(wandStart, wandEnd) : "";
const rawEditorStart = source.indexOf("\n  async toggleNoteWebRawElementEditing(");
const rawEditorEnd = source.indexOf("\n  noteDrawStableAnchorHost(", rawEditorStart);
const rawEditorMethods = rawEditorStart >= 0 && rawEditorEnd > rawEditorStart ? source.slice(rawEditorStart, rawEditorEnd) : "";
const observerStart = source.indexOf("\n  installNoteDrawDedupeObserver(");
const observerEnd = source.indexOf("\n  queueNoteDrawButtonDedupe(", observerStart);
const observerMethod = observerStart >= 0 && observerEnd > observerStart ? source.slice(observerStart, observerEnd) : "";
const bindingStart = source.indexOf("\n  refreshNoteDrawWorkspaceBinding(");
const bindingEnd = source.indexOf("\n  notifyNoteDrawWebviewChanged(", bindingStart);
const bindingMethod = bindingStart >= 0 && bindingEnd > bindingStart ? source.slice(bindingStart, bindingEnd) : "";
const externalLinkStart = source.indexOf("\n  handleExternalLinkClick(");
const externalLinkEnd = source.indexOf("\n  async handleGlobalBingEvent(", externalLinkStart);
const externalLinkMethod = externalLinkStart >= 0 && externalLinkEnd > externalLinkStart
  ? source.slice(externalLinkStart, externalLinkEnd)
  : "";
const externalLinkRegistration = source.indexOf("this.handleExternalLinkClick(event);");
const noteWebLinkRegistration = source.indexOf("void this.handleGlobalBingEvent(event);");

// Rebuild the reader-mode chrome pattern so the classifier can be asserted
// against real-world class names instead of a substring of the source.
const noisePatternMatch = /const MD_NOISE_PATTERN = \/(.+)\/;/.exec(source);
const noisePattern = noisePatternMatch ? new RegExp(noisePatternMatch[1]) : null;
const classifiesAsChrome = (className) => !!noisePattern && noisePattern.test(className.toLowerCase());

const checks = [
  ["standalone results use the available workspace width", styles.includes('.workspace-leaf-content[data-type="mobile-webviewer-view"] .mwv-results') && styles.includes("max-width: none")],
  ["NoteWeb embeds opt out of Obsidian readable line width", source.includes("prepareWebviewerDocumentLayout(embed)") && styles.includes(".mwv-note-browser-document .markdown-preview-sizer")],
  // The chrome-health probe has to look at something that really lives inside
  // the chrome. Probing for the More button (anchored beside the NoteDraw wand
  // in the leaf header) could never pass, so the 1.2 s heartbeat rebuilt the
  // whole toolbar instead of updating it — which made every control inside it
  // unclickable. Assert the live probe and the absence of the dead one.
  ["fast reload rebuilds stale or incomplete NoteWeb toolbars", source.includes("processorSessionId") && source.includes('chrome?.querySelector(".mwv-browser-address .mwv-browser-url")') && !source.includes('chrome?.querySelector(".mwv-browser-more")')],
  ["missing Markdown blocks recover the visible NoteWeb root", source.includes("restoreMissingNoteBrowserEmbed(root)") && source.includes('root.matches(\".markdown-preview-view\")') && source.includes('sizer.createDiv({ cls: \"el-div\" })')],
  ["late Markdown restoration cannot duplicate the NoteWeb root", source.includes("dedupeNoteBrowserEmbedRoots(root)") && source.includes('controller?.previewEl === embed') && source.includes('embed.dataset.mwvRecovered = \"true\"')],
  ["detached Electron webviews cannot throw from delayed events", source.includes("safeWebviewUrl(webview") && source.includes("isBrowserSurfaceReady(webview)") && source.includes("_mwvDispose") && source.includes('listen("destroyed"')],
  ["hidden Live Preview copies do not join NoteWeb processing", source.includes('sourceView = embed.closest<HTMLElement>(\".markdown-source-view\")') && source.includes('window.getComputedStyle(sourceView).display !== \"none\"')],
  ["NoteWeb removes redundant nested reading-view gutters", styles.includes(".markdown-preview-view.mwv-note-browser-document") && styles.includes("padding: 0 !important") && styles.includes("--file-margins: 0px")],
  ["duplicate in-page Mobile Webviewer branding is removed", !source.includes("Mobile Webviewer / Bing backend") && !source.includes('cls: "mwv-note-source", text: "Mobile Webviewer"')],
  ["duplicate NoteWeb document headings are hidden without changing page titles", source.includes('title.textContent?.trim().toLowerCase() === "mobile webviewer"') && styles.includes(".mwv-note-browser-redundant-title") && styles.includes('h1[data-heading="Mobile Webviewer"]')],
  ["NoteWeb uses the URL as its native Obsidian identity", source.includes("syncNoteBrowserNativeIdentity") && source.includes('file.path !== WEBVIEW_NOTE_PATH') && source.includes("tabHeaderInnerTitleEl") && source.includes('title.setText(url)')],
  ["new NoteWeb notes omit the redundant heading", !source.includes('"# Mobile Webviewer"')],
  ["home and search pages expose their own URL identity", source.includes("article.dataset.url = this.currentUrl || this.plugin.settings.homeUrl")],
  ["page identity changes refresh the NoteDraw URL controller", source.includes("if (pageChanged) this.queueNoteDrawPageRefresh()")],
  ["rebuilt home and reader content restore NoteDraw state", (source.match(/this\.queueNoteDrawPageRefresh\(\);/g) ?? []).length >= 4],
  ["NoteWeb forwards wand hold and context actions to the current URL controller", bindMethod.includes('_mwvNoteDrawBoundController') && source.includes("handleNoteDrawWebWandLifecycle") && source.includes('? "onButtonPointerDown"') && source.includes('? "onButtonContextMenu"')],
  ["NoteWeb wand click mounts or toggles the current URL controller", bindMethod.includes('event.type === "click"') && (bindMethod.includes("this.activateNoteDrawWebviewController(controller, controller.previewEl)") || bindMethod.includes("this.toggleNoteWebRawElementEditing(controller.previewEl)")) && source.includes("controller.plugin?.setInteractionController?.(controller)")],
  ["NoteWeb wand adopts NoteDraw's native button first and yields to it", wandMethod.includes(':scope > .notedraw-webview-button:not([data-mwv-browser-more=\'true\']') && wandMethod.includes("findNoteDrawWebviewSourceButton(surface)") && wandMethod.includes("nativeInAnchor") && !wandMethod.includes("globe") && !source.includes("decorateNoteDrawWebWandButton")],
  ["the host never fabricates a magic wand - NoteDraw's native button is the only wand", !wandMethod.includes('setIcon(button, "wand-sparkles")') && !wandMethod.includes('anchor.createEl("button"') && wandMethod.includes("findNoteDrawWebviewSourceButton(surface)") && wandMethod.includes("data-mwv-noteweb-wand") && wandMethod.includes("return null;")],
  ["NoteDraw keeps its live-guest controller so no second wand is ever needed", source.includes("isWandOwnerSurface(preview) || isWandOwnerSurface(surface)") && source.includes("queueNoteWebWandAdopt(embed)") && !source.includes("disposeNoteDrawControllersForRawSurface(embed)")],
  ["NoteDraw drawing layers stay hidden for the live guest until the wand is used", styles.includes('.mwv-embed.is-web-front:not([data-mwv-noteweb-element-edit="true"])') && styles.includes(".notedraw-canvas") && styles.includes(".notedraw-toolbar")],
  ["NoteWeb raw-page wand keeps Web mode and opens the element editor", source.includes('event.target.closest<NoteDrawButtonElement>(".notedraw-webview-button")') && source.includes("void this.toggleNoteWebRawElementEditing(controller.previewEl);")],
  ["NoteWeb wand activates the Markdown NoteDraw editing toolbar", source.includes("findNoteDrawPreviewController(root, true)") && source.includes("surfaceType=preview") && source.includes("activateNoteDrawControllerFromHeader(previewController, root!)")],
  ["NoteWeb drawing controls stay above its browser chrome", styles.includes(".mwv-embed.notedraw-shell > .notedraw-toolbar") && styles.includes("z-index: 1300")],
  ["NoteWeb removes its internal tab strip and status row", !chromeMethod.includes('createDiv({ cls: "mwv-tab-strip mwv-embed-tab-strip"') && !chromeMethod.includes('createDiv({ cls: "mwv-browser-status"')],
  ["NoteWeb keeps its own more menu and current page identity", chromeMethod.includes('mwv-browser-more') && chromeMethod.includes("this.ensureNoteBrowserMoreButton(embed, url, title)") && source.includes("button.dataset.mwvUrl = url") && chromeMethod.includes("this.toggleMorePanel(current, moreChrome, liveUrl, liveTitle)")],
  ["NoteWeb uses Obsidian tabs for explicit new-window navigation", source.includes('event.type === "auxclick"') && source.includes('await this.openNoteBrowser(url, true)') && source.includes('onNewWindow: (nextUrl) => this.openNoteBrowser(nextUrl, true)') && source.includes("boundToLeaf") && source.includes("requestedUrl")],
  ["NoteWeb navigation normalizes equivalent trailing-slash URLs", source.includes("equivalentEmbedUrl") && source.includes("while (previous && equivalentEmbedUrl(previous, current))") && source.includes("while (next && equivalentEmbedUrl(next, current))")],
  ["NoteWeb keeps ordinary links in the current note", source.includes('await this.openUrlInEmbed(embed, url)')],
  ["ordinary Markdown external links follow the default open mode", externalLinkMethod.includes('view?.getViewType?.() !== "markdown"') && externalLinkMethod.includes('file.extension !== "md"') && externalLinkMethod.includes("this.openExternalUrlWithDefaultMode(url, true)") && externalLinkMethod.includes('this.settings.defaultOpenMode === "obsidian"')],
  ["explicit Obsidian open links follow the default open mode", source.includes("parseObsidianOpenLink") && externalLinkMethod.includes("this.openExternalUrlWithDefaultMode(rawHref, true)") && source.includes("renderObsidianNoteEmbed") && source.includes("MarkdownRenderer.renderMarkdown")],
  ["default open mode setting defaults to RealWeb with three options", source.includes('defaultOpenMode: "obsidian" | "realweb" | "noteweb";') && source.includes('defaultOpenMode: "realweb",') && source.includes('["obsidian", "realweb", "noteweb"].includes(this.settings.defaultOpenMode)') && source.includes('this.plugin.tr("defaultOpenMode")')],
  ["RealWeb default open routes through the one-browser activation flow", source.includes("openExternalUrlWithDefaultMode(url: string, newTab = false): Promise<void> {") && source.includes("return this.activateBrowserView(url, newTab);")],
  ["stale NoteBrowser opens cannot overwrite a newer page", source.includes("noteBrowserOpenTokens") && source.includes("const isLatestRequest = () =>") && source.includes("const isCurrentOpen = () =>") && source.includes("if (this.disposed || !isLatestRequest()) return;") && source.includes("if (!isCurrentOpen()) return;") && source.includes("this.noteBrowserOpenTokens.set(leaf, requestToken)")],
  ["implicit NoteBrowser startup ignores persisted internal note links", source.includes("staleInternalTarget") && source.includes("Boolean(parseObsidianOpenLink(rememberedUrl))") && source.includes("if (input || staleInternalTarget)")],
  ["legacy localhost file links stay out of external capture", source.includes("isLegacyObsidianFileUrl") && externalLinkMethod.includes("isLegacyObsidianFileUrl(rawHref)") && source.includes("this.settings.noteBrowserUrl = this.settings.homeUrl")],
  ["internal, attachment, and download links keep Obsidian behavior", externalLinkMethod.includes('anchor.hasAttribute("download")') && externalLinkMethod.includes('anchor.classList.contains("internal-link")') && externalLinkMethod.includes('anchor.hasAttribute("data-href")') && externalLinkMethod.includes('!/^https?:\\/\\//i.test(rawHref)') && externalLinkMethod.includes('!/^https?:\\/\\//i.test(url)')],
  ["external-link capture cannot intercept NoteWeb navigation", externalLinkMethod.includes('anchor.closest(".mwv-root, .mwv-embed, .mwv-note-browser-document")') && externalLinkMethod.includes("file.path === WEBVIEW_NOTE_PATH") && externalLinkRegistration >= 0 && externalLinkRegistration < noteWebLinkRegistration],
  ["captured external links cannot escape to the system browser", externalLinkMethod.includes("event.preventDefault()") && externalLinkMethod.includes("event.stopImmediatePropagation()")],
  ["NoteWeb toolbar has stable two-row layout", styles.includes('"controls actions"') && styles.includes('"address address"') && styles.includes("grid-area: address") && styles.includes(".mwv-bing-home .mwv-bing-note-content button") && !styles.includes(".mwv-bing-home button,")],
  ["NoteWeb keeps an editable in-content address row for new URLs", styles.includes(".mwv-note-browser-document .mwv-browser-address") && styles.includes(".mwv-note-browser-document .mwv-browser-controls") && styles.includes('"address"') && styles.includes(".mwv-note-browser-document .mwv-embed.is-web-front > .mwv-browser-chrome")],
  ["NoteWeb real web mode keeps the address row above the raw guest", styles.includes(".mwv-embed.is-web-front > :not(.mwv-live-browser):not(.mwv-browser-chrome)") && styles.includes(".mwv-embed.is-web-front > .mwv-browser-chrome") && styles.includes("pointer-events: auto !important")],
  ["NoteWeb result tabs and media stay borderless", styles.includes(".mwv-note-browser-document .mwv-bing-home .mwv-bing-tab") && styles.includes("border: 0 !important") && styles.includes(".mwv-note-browser-document .mwv-page-media img")],
  ["NoteWeb real-web mode renders the original page including the home URL", source.includes('(mode === "web" || mode === "split") && !embed.querySelector(":scope > .mwv-live-browser")') && source.includes("this.renderLiveBrowserSurface(embed, liveUrl)") && source.includes('cls: "mwv-bing-note-content"') && styles.includes(".mwv-embed.is-web-front > :not(.mwv-live-browser)")],
  ["NoteWeb creates at most one direct live browser surface", source.includes("Array.from(embed.children)") && source.includes("existing.slice(1)") && source.includes("querySelector(\":scope > .mwv-live-frame\")")],
  ["Note/Web switching retains one live page without navigation or URL assignment", modeMethod.includes("retainedSurface") && modeMethod.includes("currentSurface !== retainedSurface") && !modeMethod.includes("renderEmbed(") && !modeMethod.includes("loadURL") && !modeMethod.includes(".src =") && !modeMethod.includes("openUrlInEmbed") && modeMethod.includes("reconcileNoteWebDocumentWithLiveSurface")],
  ["NoteWeb reconciliation compares the note's own rendered URL", source.includes('embed.dataset.mwvNoteRenderedUrl = url;') && source.includes('const renderedUrl = embed.dataset.mwvNoteRenderedUrl || embed.dataset.url || "";') && source.includes("if (!renderedUrl || this.sameWebPage(renderedUrl, liveUrl)) return;")],
  ["NoteWeb reconciliation follows only an already-navigated guest", source.includes("reconcileNoteWebDocumentWithLiveSurface(embed: HTMLElement): void {") && source.includes("void this.openUrlInEmbed(embed, liveUrl, false)") && source.includes("syncRetainedLiveSurface(embed, nextUrl)") && source.includes("const renderedUrl = embed.dataset.mwvNoteRenderedUrl")],
  ["NoteWeb Web mode gives the raw guest exclusive ownership of the viewport", styles.includes(".mwv-embed.is-web-front > :not(.mwv-live-browser)") && styles.includes("pointer-events: none !important") && !styles.includes("--mwv-web-safe-top")],
  ["NoteWeb keeps its address row after a Markdown preview rebuild", styles.includes(":has(.mwv-embed[data-url]) .mwv-browser-chrome") && styles.includes(":has(.mwv-embed[data-url]) .mwv-browser-address") && source.includes("markdown-preview-sizer")],
  ["NoteWeb double-clicks cannot switch Obsidian into edit mode", source.includes('["mousedown", "click", "dblclick"]') && doubleActivationMethod.includes("event.detail < 2") && doubleActivationMethod.includes("event.stopImmediatePropagation()") && doubleActivationMethod.includes("file.path !== WEBVIEW_NOTE_PATH")],
  ["NoteWeb double-click containment preserves native text selection", !doubleActivationMethod.includes("event.preventDefault")],
  ["NoteWeb ownership is resolved from the exact Mobile Webviewer leaf", ownershipMethods.includes("isNoteBrowserLeaf") && ownershipMethods.includes("file.path === WEBVIEW_NOTE_PATH") && ownershipMethods.includes("findWorkspaceLeafForElement(element)")],
  ["ordinary Markdown leaves are skipped before any NoteDraw residue cleanup", cleanupMethod.includes("const noteWebLeaf = this.isNoteBrowserLeaf(workspaceLeaf);") && cleanupMethod.includes("const hasMwvResidue =") && cleanupMethod.includes("if (!noteWebLeaf && !hasMwvResidue) continue;") && cleanupMethod.indexOf("if (!noteWebLeaf && !hasMwvResidue) continue;") < cleanupMethod.indexOf("button.removeClass(\"notedraw-webview-button\")") && cleanupMethod.indexOf("if (!noteWebLeaf && !hasMwvResidue) continue;") < cleanupMethod.indexOf("leaf.removeClass(\"mwv-notedraw-surface-leaf\")")],
  ["global NoteDraw observer ignores mutations outside the NoteWeb leaf", observerMethod.includes("if (!this.isNoteWebOwnedElement(root)) continue;") && !observerMethod.includes("cleanupStaleNoteDrawButtonResidue")],
  ["NoteWeb refresh never triggers global ordinary-note NoteDraw source/header passes", source.includes("if (!root?.isConnected || !this.isNoteWebOwnedElement(root)) return;") && !bindingMethod.includes("syncSourceControllers") && !bindingMethod.includes("syncMobileWebviewerHeaderButtons") && !bindingMethod.includes('workspace.trigger?.("layout-change")')],
  ["NoteDraw controller discovery cannot fall back to another leaf", source.includes("if (!this.noteDrawControllerBelongsToRoot(controller, root)) return;") && source.includes("return leaves.filter((leaf) => !this.isRawNoteWebLeaf(leaf));")],
  ["NoteWeb blocks source mode at the view-state boundary", source.includes("guardedSetState") && source.includes('state.mode === "source" || state.source === true') && source.includes('file.path === WEBVIEW_NOTE_PATH') && (source.includes('binding.view.setState === binding.guardedSetState') || source.includes('view.setState === binding.guardedSetState'))],
  ["NoteWeb also recovers from unexpected source mode", source.includes("this.enforceNoteBrowserReadingMode();") && source.includes("enforceNoteBrowserReadingMode(): void") && source.includes('state.mode !== "preview" || state.source !== false') && source.includes("applyReadingMode();")],
  ["NoteWeb Markdown controls are fused into Obsidian native actions and pane menu", source.includes("syncNoteBrowserNativeActions") && source.includes("view.addAction") && source.includes("view.onPaneMenu") && source.includes("view-header-nav-buttons") && source.includes("mwv-note-browser-native-nav") && source.includes("event.stopPropagation()") && styles.includes(".mwv-note-browser-document .mwv-browser-chrome") && styles.includes("display: none !important")],
  ["NoteWeb replaces the Obsidian edit toggle with Note/Web mode", source.includes("mwv-note-browser-mode-action") && source.includes("mwv-note-browser-replaced-edit-action") && styles.includes(".mwv-note-browser-replaced-edit-action") && !source.includes('addNativeAction("arrow-left"') && !source.includes('addNativeAction("arrow-right"')],
  ["NoteWeb wand opens NoteDraw in element selection mode", source.includes("setNoteDrawWebviewTool(controller, \"select\")") && source.includes("setToolFromApi") && source.includes("controller.toolMode === \"edit-md\"")],
  ["NoteWeb shared element button edits both preview and webview note surfaces", source.includes('if (controller.surfaceType === "webview")') && source.includes('this.isNoteBrowserRawEditingMode(surface)') && source.includes('editing ? "select" : "edit-md"') && source.includes('controller.surfaceType === "preview"')],
  ["NoteWeb search results omit the recommendation column", !source.includes('side.createEl("h3"') && !source.includes('cls: "mwv-related-pill"') && styles.includes(".mwv-bing-serp") && styles.includes("grid-template-columns: minmax(0, 1fr)")],
  ["NoteWeb Web mode fills the actual Markdown viewport through NoteDraw wrappers", styles.includes(":has(.mwv-embed.is-web-front) > .markdown-preview-sizer") && styles.includes("> .notedraw-reading-stage > .markdown-preview-sizer") && styles.includes("min-height: 0 !important") && styles.includes("padding-bottom: 0 !important") && styles.includes(".el-div:has(> .mwv-embed.is-web-front)") && styles.includes("height: 100%") && !styles.includes("height: max(480px, 68vh)")],
  ["NoteWeb deepest live webview remains unscaled and fills its flex-sized raw surface", styles.includes(".mwv-bing-home.is-web-front > .mwv-live-browser > .mwv-real-webview") && styles.includes("display: flex") && styles.includes("flex: 1 1 auto") && styles.includes("min-height: 0") && source.includes('frame.setCssStyles({ zoom: "1" })')],
  ["real webpages stay raw after delayed WebView callbacks", source.includes("isRawRealWebview") && source.includes("isRawRealBrowserSurface") && source.includes("if (this.isRawRealWebview(webview)) return;") && source.includes("if (this.isRawRealBrowserSurface(frame)) return;") && source.includes("const rawWebview = this.isRawRealBrowserSurface(frame)") && source.includes("frame.setZoomFactor?.(rawWebview ? 1 : zoom / 100)") && styles.includes("filter: none !important") && styles.includes("transform: none !important")],
  ["raw WebView surfaces opt out of every guest-page injection path", source.includes("raw?: boolean") && source.includes("raw: true") && source.includes("const keepGuestUntouched = callbacks.raw === true") && source.includes("if (!keepGuestUntouched)") && source.includes("mwv-raw-surface")],
  ["Bing homepage uses the current Chromium desktop UA without guest-page patches", source.includes('if (url && this.isBingHome(url))') && source.includes("process?.versions?.chrome") && source.includes("Chrome/${chromeMajor}.0.0.0") && source.includes("this.applyBrowserSurfaceUserAgent(webview, url)")],
  ["Bing UA is selected before every programmatic main-page navigation", source.includes("this.applyBrowserSurfaceUserAgent(surface, url);") && source.indexOf("this.applyBrowserSurfaceUserAgent(surface, url);") < source.indexOf("surface.loadURL(url)")],
  ["WebView lifecycle listeners bind before cached navigation can start", source.indexOf("this.bindRealBrowserSurface(webview, callbacks);") < source.indexOf("if (url) webview.src = url;") && source.indexOf("if (url) webview.src = url;") < source.indexOf("parent.appendChild(webview);")],
  ["WebView navigation APIs wait for dom-ready", source.includes("isBrowserSurfaceReady") && source.includes("_mwvReady") && source.includes("setBrowserSurfaceUrl") && source.includes("navigateEmbedBack") && source.includes("navigateEmbedForward")],
  ["destroyed WebViews release every registered listener", source.includes("_mwvDispose") && source.includes('listen("destroyed"') && source.includes("removeEventListener") && source.includes("disposeBrowserSurfacesIn")],
  ["raw WebView ignores subframe failures", source.includes("isMainFrame?: boolean") && source.includes("if (detail.isMainFrame === false) return;")],
  ["raw Web mode does not fall back to reader after a delayed load error", source.includes('if (this.frontendMode === "web" && this.plugin.isRawRealBrowserSurface(this.surfaceEl)) return;') && source.includes('if (embed.hasClass("is-web-front")) return;')],
  ["standalone Web mode is a single stable WebView without delayed NoteDraw mounting", source.includes("is-raw-web") && styles.includes(".mwv-root.is-raw-web .mwv-home") && styles.includes(".mwv-root.is-raw-web .notedraw-canvas") && styles.includes("position: absolute") && source.includes("void forceEditMode") && !source.includes("this.plugin.notifyNoteDrawWebviewChanged(root, shouldForceEdit)")],
  ["NoteWeb Web mode hides retained NoteDraw canvases and layers", styles.includes(".mwv-embed.is-web-front") && styles.includes(".notedraw-static-canvas") && styles.includes(".notedraw-embed-layer") && styles.includes("display: none !important") && styles.includes("pointer-events: none !important")],
  ["NoteWeb Web mode keeps NoteDraw's wand adopted into the stable anchor", source.includes("ensureNoteWebWandProxy(surface)") && source.includes("ensureNoteWebWandProxy(embed)") && source.includes(":scope > .notedraw-webview-button:not([data-mwv-browser-more='true'])") && source.includes("queueNoteWebWandAdopt(embed)") && styles.includes(".mwv-notedraw-anchor") && styles.includes(".view-actions > .notedraw-webview-button")],
  ["NoteWeb magic wand stays host-side while its selector explicitly bridges the guest", source.includes("this.noteDrawStableAnchorHost(surface)") && wandMethod.includes("this.ensureNoteDrawStableAnchor(surface)") && rawEditorMethods.includes("noteWebRawElementEditorScript") && rawEditorMethods.includes("frame.executeJavaScript(code, true)")],
  ["retained NoteDraw wand toggles raw Web editing on every click", bindMethod.includes("this.isNoteBrowserWebMode(controller.previewEl)") && bindMethod.includes("this.toggleNoteWebRawElementEditing(controller.previewEl)") && source.includes("void this.toggleNoteWebRawElementEditing(controller.previewEl)")],
  ["leaving raw Web editing preserves NoteDraw static drawings", rawEditorMethods.includes("mwvNotewebDrawingVisible") && rawEditorMethods.includes("embed.dataset.mwvNotewebDrawingVisible = \"true\"") && !rawEditorMethods.includes("this.disposeNoteDrawControllersForRawSurface(embed)") && styles.includes("data-mwv-noteweb-drawing-visible=\"true\"") && styles.includes(".notedraw-static-canvas")],
  ["delayed raw toolbar refresh cannot reopen after wand close", source.includes("if (this.isNoteBrowserWebMode(previewEl) && !this.isNoteBrowserRawEditingMode(previewEl)) return;")],
  ["raw-page editor exposes a dedicated element selection tool", rawEditorMethods.includes("mwv-noteweb-element-select") && rawEditorMethods.includes("选择网页元素编辑文字") && rawEditorMethods.includes("mouse-pointer-2") && styles.includes(".mwv-noteweb-element-toolbar")],
  ["raw-page text edits are selected inside the guest and persisted by URL", rawEditorMethods.includes("editableSelector") && rawEditorMethods.includes("data-mwv-noteweb-selected") && rawEditorMethods.includes("__MWV_BRIDGE__") && source.includes("pageEdits: normalizeBrowserWebTextEdits")],
  ["raw element selector state stays synchronized after NoteDraw toolbar takeover", rawEditorMethods.includes("selectButtons = Array.from(embed.querySelectorAll") && rawEditorMethods.includes("selectButtons.forEach") && rawEditorMethods.includes('button.setAttribute("aria-pressed", String(enabled))')],
  ["raw NoteDraw keeps the user's brush/text mode after delayed toolbar refresh", source.includes("bindNoteDrawRawToolButtons") && source.includes("if (!controller.toolMode) this.setNoteDrawWebviewTool(controller, \"select\")") && source.includes("syncNoteWebRawDrawingState(surface, controller)")],
  ["raw NoteDraw secondary panels stay hidden until their own state opens them", !source.includes("controller.palettePanel?.addClass(\"is-drawing-active\")") && !source.includes("controller.formatToolbar?.addClass(\"is-drawing-active\")") && styles.includes(".notedraw-palette-panel.is-palette-open.is-notedraw-controls-visible") && styles.includes(".notedraw-format-toolbar.is-visible.is-notedraw-controls-visible")],
  ["raw NoteDraw canvas receives pointer input only outside guest element selection", styles.includes('data-mwv-noteweb-element-edit="true"]:not([data-mwv-noteweb-element-selector="true"])') && styles.includes(".notedraw-canvas") && styles.includes("pointer-events: auto !important") && source.includes("setNoteWebRawElementSelector(surface, false)")],
  ["NoteWeb reader adds the element-edit button to webview controllers", source.includes("if (controller) this.ensureNoteWebElementSelectButton(controller, surface)") && source.includes("if (!this.isNoteDrawControllerActive(controller))") && source.includes("this.setNoteDrawWebviewTool(controller, editing ? \"select\" : \"edit-md\")")],
  ["raw-page NoteDraw guard allows only the explicit guest-edit exception", source.includes("isRawNoteDrawExcludedSurface") && source.includes('rawRoot.dataset.mwvNotewebElementEdit === "true"') && source.includes("isNoteBrowserRawEditingMode(root)")],
  ["NoteWeb magic wand proxy is removed when leaving the NoteWeb surface", source.includes("this.removeNoteWebWandProxy(embed)") && source.includes("removeNoteWebWandProxy(surface)") && source.includes("data-mwv-noteweb-wand='true'") && source.includes("?.remove()")],
  ["Web-to-Note mode switch restores the current NoteDraw toolbar", modeMethod.includes("cleanupStaleNoteDrawButtonResidue(leafContent)") && modeMethod.includes("refreshNoteDrawWorkspaceBinding(embed, true, false)") && modeMethod.includes("queueNoteDrawControllerSync(embed, true)")],
  ["NoteDraw hidden markers are scoped to Web mode", cleanupMethod.includes("hasMobileWebviewerWebMode") && cleanupMethod.includes("if (hasMobileWebviewerWebMode && button.hasClass(\"mwv-notedraw-webviewer-header-hidden\"))") && cleanupMethod.includes("!hasMobileWebviewerSurface && button.hasClass(\"mwv-notedraw-webviewer-header-hidden\")")],
  ["NoteWeb reapplies class-based raw-surface isolation after delayed NoteDraw mutations", source.includes("applyNoteBrowserWebIsolation") && source.includes("mwv-noteweb-raw-hidden") && source.includes('element.addClass("mwv-noteweb-raw-hidden")') && source.includes('element.removeClass("mwv-noteweb-raw-hidden")') && styles.includes(".mwv-note-browser-document .mwv-noteweb-raw-hidden") && !source.includes("mwvRawWebHiddenStyle") && !source.includes("element.style.setProperty(") && source.includes("mutationRoot") && source.includes("isNoteBrowserWebMode(mutationRoot)")],
  ["switching away from NoteWeb sweeps stale markers from every ordinary leaf", source.includes('this.app.workspace.on("active-leaf-change"') && source.includes("cleanupNoteBrowserDocumentResidue(this.app.workspace.containerEl)") && source.includes("isStillNoteBrowser")],
  ["NoteWeb never installs the legacy T A pen layer into the real page", bridgeMethod.includes("cleanupLegacyWebNoteOverlay") && bridgeMethod.includes('doc.getElementById("mwv-page-note-root")?.remove()') && !bridgeMethod.includes("installWebNoteOverlay();")],
  ["NoteWeb never replaces a live page with cached page HTML", !source.includes("doc.body.innerHTML = payload.pageHtml") && !source.includes("this.hydrateWebviewPageNote(")],
  ["NoteWeb does not let NoteDraw virtual height resize the real web page", source.includes('root.matches(".mwv-embed.is-web-front, .mwv-note-embed.is-web-front, .mwv-bing-home.is-web-front")')],
  ["raw Web surfaces are hard-excluded before NoteDraw mounts a controller", source.includes("installNoteDrawRawSurfaceGuard") && source.includes("isRawNoteDrawExcludedSurface") && source.includes("noteDrawRawSurfaceGuardRunning") && source.includes("Object.defineProperty(documentEl, \"querySelectorAll\"")],
  ["raw Web mode keeps NoteDraw's own wand instead of destroying its controller", source.includes("disposeNoteDrawControllersForRawSurface") && source.includes("notedraw-body-control") && source.includes("documentEl.body?.querySelectorAll") && !modeMethod.includes("disposeNoteDrawControllersForRawSurface(embed)") && modeMethod.includes("queueNoteWebWandAdopt(embed)")],
  ["standalone Web to NoteWeb transition clears all raw NoteDraw controllers", source.includes("disposeAllRawNoteDrawControllers") && source.includes("this.plugin.disposeAllRawNoteDrawControllers()")],
  ["NoteWeb chrome drops redundant web/note/home/reload buttons", !chromeMethod.includes('makeNavButton("rotate-cw"') && !chromeMethod.includes("makeModeButton") && !chromeMethod.includes('cls: "mwv-browser-home"')],
  ["More button lives beside the NoteDraw wand with its own icon", chromeMethod.includes("this.ensureNoteBrowserMoreButton(embed, url, title)") && source.includes("data-mwv-browser-more") && styles.includes(".mwv-notedraw-anchor .mwv-browser-more")],
  ["no NoteDraw plugin means no wand at all", wandMethod.includes("if (!this.getNoteDrawPlugin()) {") && wandMethod.includes("this.removeNoteWebWandProxy(surface);") && wandMethod.includes("return null;")],
  ["wand stays untouched - NoteDraw owns its icon and label", !source.includes("decorateNoteDrawWebWandButton") && !source.includes("mwvWebWandDecorated") && !source.includes("mwv-web-wand-globe") && styles.includes(".mwv-notedraw-anchor .notedraw-webview-button")],
  ["raw isolation is explicitly marked on the standalone root", source.includes('toggleClass("is-raw-web", rawRoot)') && source.includes('toggleAttribute("data-notedraw-ignore", rawRoot)') && source.includes('removeAttribute("data-notedraw-ignore"')],
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
  ["legacy drawing storage remains as recovery data", !source.includes("delete(legacyController.file") && !source.includes("remove(legacyController.file")],
  // Reader-mode HTML -> Markdown extraction
  ["reader mode converts fetched pages through the structured Markdown pipeline", source.includes("htmlDocumentToMarkdown(candidate, url)") && source.includes("htmlDocumentToMarkdown(doc.body, url)")],
  ["reader mode keeps the richest candidate container instead of the first match", source.includes("const addCandidate = (element: Element | null) =>") && source.includes("if (markdown.length > content.length)") && source.includes("let bestRoot: Element | null = null")],
  ["reader mode reads link suggestions from the container it actually rendered", source.includes("const linkRoot = bestRoot ?? doc.body") && source.includes("linkRoot?.querySelectorAll<HTMLAnchorElement>(\"a[href]\")")],
  ["reader mode emits GFM tables and escapes cell pipes", source.includes('replace(/\\|/g, "\\\\|")') && source.includes("Array<string>(columns).fill(\"---\")")],
  ["reader mode degrades single-column tables to lists", source.includes("if (columns < 2)") && source.includes("`- ${cell}`")],
  ["reader mode writes task list markers exactly once", source.includes('head.replace(/^\\[[ xX]\\]\\s*/, "")')],
  ["reader mode does not repeat a details summary label", source.includes("details.cloneNode(true) as HTMLElement") && source.includes('clone.querySelectorAll(":scope > summary")')],
  ["reader mode pairs definition terms with their definitions", source.includes("`**${term}**: ${inline}`")],
  ["reader mode preserves Markdown hard line breaks", source.includes("function mdNormalizeBlockWhitespace(") && source.includes("line.length - bare.length >= 2")],
  ["reader mode indents list continuations by marker width", source.includes('mdIndentBlock(block, " ".repeat(marker.length))')],
  ["reader mode trims oversized blocks instead of dropping whole sections", source.includes("const budget = MD_MAX_READER_CHARS - length") && source.includes("const slice = clean.slice(0, budget)")],
  ["reader mode noise filter keeps layout containers and drops real chrome", source.includes("function mdIsNoiseElement(") && source.includes("MD_NOISE_PATTERN.test(className)") &&
    classifiesAsChrome("layout__right-sidebar reference-layout__toc") &&
    classifiesAsChrome("related-articles") &&
    classifiesAsChrome("advertisement banner") &&
    classifiesAsChrome("newsletter-signup") &&
    !classifiesAsChrome("layout__content reference-layout__content") &&
    !classifiesAsChrome("layout__body reference-layout__body") &&
    !classifiesAsChrome("layout__header reference-layout__header")],
  ["reader mode exposes a debug hook for converter regression probes", source.includes("__mwvConvertHtml") && source.includes("__mwvReaderDebug")],
  ["mobile direct-open forces reading mode on file-open and leaf change", source.includes('on("file-open"') && source.includes("this.enforceNoteBrowserReadingMode()")],
  ["reading-mode enforcement re-sweeps stale preview embeds", source.includes("this.processWebviewerEmbeds(leaf.view.containerEl)")],
  ["More panel stays visible in Web mode", styles.includes(":not(.mwv-extension-panel):not(.mwv-more-panel)") && styles.includes(".mwv-embed.is-web-front > .mwv-extension-panel")],
  ["More menu entry rebuilds missing chrome instead of no-op", source.includes("this.renderBrowserChrome(current, url, title || hostName(url))") && source.includes("embed.appendChild(panel)")],
  ["native menu actions never use a detached embed", source.includes('querySelector<HTMLElement>(".mwv-embed[data-url]")') && source.includes("if (embed.isConnected) return embed")]
];

const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);

if (failed.length) {
  console.error(`Note browser verification failed: ${failed.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`Note browser verification passed (${checks.length}/${checks.length}).`);
}
