import fs from "node:fs";

const source = fs.readFileSync("main.ts", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

const bindStart = source.indexOf("bindNoteDrawWebviewButton(");
const bindEnd = source.indexOf("\n  isMobileWebviewerSurface(", bindStart);
const bindMethod = bindStart >= 0 && bindEnd > bindStart ? source.slice(bindStart, bindEnd) : "";

const checks = [
  ["standalone results use the available workspace width", styles.includes('.workspace-leaf-content[data-type="mobile-webviewer-view"] .mwv-results') && styles.includes("max-width: none")],
  ["NoteWeb embeds opt out of Obsidian readable line width", source.includes("prepareWebviewerDocumentLayout(embed)") && styles.includes(".mwv-note-browser-document .markdown-preview-sizer")],
  ["fast reload rebuilds stale or emptied NoteWeb containers", source.includes("processorSessionId") && source.includes('embed.querySelector(\":scope > .mwv-browser-chrome\")')],
  ["missing Markdown blocks recover the visible NoteWeb root", source.includes("restoreMissingNoteBrowserEmbed(root)") && source.includes('root.matches(\".markdown-preview-view\")') && source.includes('sizer.createDiv({ cls: \"el-div\" })')],
  ["late Markdown restoration cannot duplicate the NoteWeb root", source.includes("dedupeNoteBrowserEmbedRoots(root)") && source.includes('controller?.previewEl === embed') && source.includes('embed.dataset.mwvRecovered = \"true\"')],
  ["detached Electron webviews cannot throw from delayed events", source.includes("safeWebviewUrl(webview") && (source.match(/if \(!webview\.isConnected\) return;/g) ?? []).length >= 8],
  ["hidden Live Preview copies do not join NoteWeb processing", source.includes('sourceView = embed.closest<HTMLElement>(\".markdown-source-view\")') && source.includes('window.getComputedStyle(sourceView).display !== \"none\"')],
  ["NoteWeb removes redundant nested reading-view gutters", styles.includes(".markdown-preview-view.mwv-note-browser-document") && styles.includes("padding-right: 8px")],
  ["duplicate in-page Mobile Webviewer branding is removed", !source.includes("Mobile Webviewer / Bing backend") && !source.includes('cls: "mwv-note-source", text: "Mobile Webviewer"')],
  ["duplicate NoteWeb document headings are hidden without changing page titles", source.includes('title.textContent?.trim().toLowerCase() === "mobile webviewer"') && styles.includes(".mwv-note-browser-redundant-title") && styles.includes(".mwv-note-browser-document .markdown-preview-sizer > .el-h1")],
  ["new NoteWeb notes omit the redundant heading", !source.includes('"# Mobile Webviewer"')],
  ["home and search pages expose their own URL identity", source.includes("article.dataset.url = this.currentUrl || this.plugin.settings.homeUrl")],
  ["page identity changes refresh the NoteDraw URL controller", source.includes("if (pageChanged) this.queueNoteDrawPageRefresh()")],
  ["rebuilt home and reader content restore NoteDraw state", (source.match(/this\.queueNoteDrawPageRefresh\(\);/g) ?? []).length >= 4],
  ["Mobile Webviewer leaves NoteDraw native button events intact", bindMethod.includes("NoteDraw owns this button") && !bindMethod.includes("preventDefault") && !bindMethod.includes("addEventListener")],
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
