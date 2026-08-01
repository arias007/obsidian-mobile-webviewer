import fs from "node:fs";

const source = fs.readFileSync("main.ts", "utf8");

const checks = [
  ["versioned public API is exposed", source.includes("readonly api: MobileWebviewerApi") && source.includes('apiVersion: MOBILE_WEBVIEWER_API_VERSION')],
  ["API covers context, navigation, tabs, lists, and events", [
    '"getCurrentContext"',
    '"getSelection"',
    '"readPage"',
    '"open"',
    '"listTabs"',
    '"newTab"',
    '"switchTab"',
    '"closeTab"',
    '"toggleBookmark"',
    '"addToReadingList"',
    '"sendToCancip"',
    '"subscribe"'
  ].every((method) => source.includes(method))],
  ["active context resolves standalone and embedded browser surfaces", source.includes("resolveActiveWebContextTarget") && source.includes('.mwv-embed[data-url]') && source.includes("getLeavesOfType(VIEW_TYPE)")],
  ["selection supports Chromium webview and iframe fallback", source.includes("surface.executeJavaScript") && source.includes("contentWindow?.getSelection")],
  ["reader context includes selection, edited text, images, and links", source.includes("selectedText") && source.includes("note.noteText || note.pageText") && source.includes("images: cached?.images") && source.includes("links: cached?.links")],
  ["refresh failure restores the previous reader cache", source.match(/if \(previousCache\) this\.settings\.pageCache = previousCache/g)?.length >= 2],
  ["tab API returns compact summaries without navigation history", source.includes("browserTabSummaryForApi") && source.includes("canGoBack: tab.back.length > 0") && !source.includes("return this.settings.browserTabs.map((tab) => ({ ...tab, back:")],
  ["Cancip receives structured context before clipboard fallback", source.includes("cancip?.api?.receiveExternalContext") && source.includes('route: "api"') && source.includes('route: "clipboard"')],
  ["sending context does not submit by default", source.includes("submit: Boolean(input.submit)")],
  ["API observers are isolated from listener failures", source.includes("private apiListeners = new Set") && source.includes("API listener failed")]
];

const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);

if (failed.length) {
  console.error(`Cancip integration verification failed: ${failed.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`Cancip integration verification passed (${checks.length}/${checks.length}).`);
}
