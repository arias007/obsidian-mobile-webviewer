/**
 * The reader pipeline behind NoteWeb.
 *
 * Two production-grade libraries do the heavy lifting, because hand-rolled
 * extraction kept losing pages that a real browser shows perfectly:
 *
 *  - **Readability** (Mozilla, Apache-2.0) is the algorithm Firefox's reader
 *    mode ships. It scores the DOM and picks the article, instead of guessing
 *    "the biggest container".
 *  - **Turndown** (MIT) turns that article HTML into Markdown with GFM tables,
 *    strikethrough and task lists, instead of flattening it to newlines.
 *
 * The same Readability build also runs *inside* the guest page — see
 * src/reader-live-entry.js — which is what makes anti-bot pages readable:
 * baike.baidu.com answers a plain fetch with a 403 "安全验证" wall while the
 * rendered DOM holds the whole article.
 */
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { tables, strikethrough, taskListItems } from "turndown-plugin-gfm";

import { READER_LIVE_SCRIPT } from "./reader-live.generated";

export { READER_LIVE_SCRIPT };

/** Nodes that never carry article text. */
const READER_DROP_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "form",
  "button",
  "input",
  "select",
  "textarea",
  "[aria-hidden='true']",
  "[hidden]"
];

/** Readability refuses pages shorter than this; below it we fall back to DOM text. */
export const READER_CHAR_THRESHOLD = 220;

/** Below this the reader page is treated as "extraction failed". */
export const READER_MIN_CONTENT_CHARS = 200;

export interface ReaderArticle {
  title: string;
  byline: string;
  siteName: string;
  publishedTime: string;
  excerpt: string;
  lang: string;
  dir: string;
  /** Clean article HTML, links/images already absolute. */
  html: string;
  /** Plain text of the article, used for length checks and search. */
  text: string;
  /** Turndown output. */
  markdown: string;
  length: number;
  method: "readability" | "dom-fallback" | "live";
}

export interface LiveReaderPayload {
  ok?: boolean;
  reason?: string;
  method?: string;
  title?: string;
  byline?: string;
  siteName?: string;
  publishedTime?: string;
  excerpt?: string;
  lang?: string;
  dir?: string;
  html?: string;
  text?: string;
  length?: number;
  baseUrl?: string;
}

/**
 * Signatures of interstitial/anti-bot pages. They render to a real page in the
 * Chromium guest but extract to nothing over HTTP, so the reader has to know
 * the difference between "this page is empty" and "this fetch was refused".
 */
const BLOCKED_PAGE_PATTERNS: RegExp[] = [
  /百度安全验证/,
  /security verification/i,
  /just a moment/i,
  /cf-browser-verification/i,
  /checking your browser/i,
  /enable javascript and cookies/i,
  /请开启\s*JavaScript/i,
  /请输入验证码/,
  /访问验证/,
  /Environment\.Check/i
];

export function looksLikeBlockedPage(html: string): boolean {
  if (!html) return true;
  const head = html.slice(0, 6000);
  for (const pattern of BLOCKED_PAGE_PATTERNS) {
    if (pattern.test(head)) return true;
  }
  return false;
}

/** The rendered body a live extraction must beat to be worth rendering. */
export function isUsableReaderMarkdown(markdown: string, minChars = READER_MIN_CONTENT_CHARS): boolean {
  if (!markdown) return false;
  return markdown.replace(/\s+/g, " ").trim().length >= minChars;
}

/**
 * Recognises the reader's own failure pages.
 *
 * A failed extraction used to be saved as a web note, and from then on the
 * cached failure always won over a fresh extraction — the single most common
 * report being "NoteWeb still cannot convert this page". The failure shape is
 * deliberate and narrow (a heading, a quoted hint, a short tail ending in the
 * URL), so real articles never match it.
 */
export function looksLikeReaderFailure(text: string | null | undefined): boolean {
  const clean = (text ?? "").trim();
  if (!clean) return true;
  if (
    /No readable document body|HTTP response is blocked|HTTP response yielded too little|reading the rendered page instead/i.test(
      clean
    )
  ) {
    return true;
  }
  const lines = clean
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  // A page whose whole body is a quoted hint followed by the bare URL.
  if (lines.length <= 6 && /^https?:\/\//i.test(lines[lines.length - 1] ?? "") && lines.some((line) => line.startsWith(">"))) {
    return true;
  }
  return false;
}

function createTurndownService(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    fence: "```",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
    br: ""
  });

  service.use(tables);
  service.use(strikethrough);
  service.use(taskListItems);

  // Chrome that must not reach the Markdown as text. Checkboxes stay: the GFM
  // task-list rule downstream needs the input node to know a list is a task
  // list, and removing it here silently downgraded every checklist to bullets.
  service.remove((node: Node) => {
    const element = node as Element;
    const name = node.nodeName.toLowerCase();
    if (name === "input") return (element.getAttribute("type") ?? "").toLowerCase() !== "checkbox";
    if (READER_DROP_SELECTORS.some((selector) => selector === name)) return true;
    if (element.getAttribute("aria-hidden") === "true") return true;
    if (element.hasAttribute("hidden")) return true;
    return false;
  });

  // Turndown's stock list rule writes "-   item" (marker + three spaces). The
  // compact "- item" form is what every Markdown editor produces and what
  // Obsidian re-renders without reflowing nested lists.
  service.addRule("mwvListItem", {
    filter: "li",
    replacement: (content: string, node: Node, options: TurndownService.Options): string => {
      const element = node as HTMLElement;
      const body = (content || "")
        .replace(/^\n+/, "")
        .replace(/\n+$/, "\n");
      const parent = element.parentNode as HTMLElement | null;
      let marker = `${options.bulletListMarker} `;
      if (parent && parent.nodeName === "OL") {
        const start = parent.getAttribute("start");
        const index = Array.prototype.indexOf.call(parent.children, element);
        marker = `${start ? Number(start) + index : index + 1}. `;
      }
      const indent = " ".repeat(marker.length);
      const indented = body.replace(/\n(?!$)/g, `\n${indent}`);
      return marker + indented + (element.nextSibling && !/\n$/.test(indented) ? "\n" : "");
    }
  });

  // Fenced code with the language from class="language-xxx" / hljs / data-lang.
  service.addRule("mwvFencedCode", {
    filter: (node: Node): boolean => node.nodeName === "PRE",
    replacement: (_content: string, node: Node): string => {
      const element = node as HTMLElement;
      const codeEl = element.querySelector("code") ?? element;
      const raw = codeEl.textContent ?? "";
      const code = raw.replace(/\n+$/, "");
      if (!code.trim()) return "";
      const language = detectCodeLanguage(codeEl) || detectCodeLanguage(element);
      const fence = code.includes("```") ? "````" : "```";
      return `\n\n${fence}${language}\n${code}\n${fence}\n\n`;
    }
  });

  // Images: prefer the lazy attributes and keep the alt text.
  service.addRule("mwvImage", {
    filter: "img",
    replacement: (_content: string, node: Node): string => {
      const element = node as HTMLImageElement;
      const src =
        element.getAttribute("src") ||
        element.getAttribute("data-src") ||
        element.getAttribute("data-original") ||
        "";
      if (!src || /^(?:data:|blob:)/i.test(src)) return "";
      const alt = (element.getAttribute("alt") ?? element.getAttribute("title") ?? "").replace(/\s+/g, " ").trim();
      const title = (element.getAttribute("title") ?? "").replace(/\s+/g, " ").trim();
      return `![${alt}](${src}${title && title !== alt ? ` "${title}"` : ""})`;
    }
  });

  // <figure><img><figcaption>…</figcaption></figure> -> image + caption line.
  service.addRule("mwvFigure", {
    filter: "figure",
    replacement: (_content: string, node: Node): string => {
      const element = node as HTMLElement;
      const img = element.querySelector("img");
      const captionEl = element.querySelector("figcaption");
      const caption = (captionEl?.textContent ?? "").replace(/\s+/g, " ").trim();
      const parts: string[] = [];
      if (img) {
        const src =
          img.getAttribute("src") ||
          img.getAttribute("data-src") ||
          img.getAttribute("data-original") ||
          "";
        if (src && !/^(?:data:|blob:)/i.test(src)) {
          const alt = (img.getAttribute("alt") ?? "").replace(/\s+/g, " ").trim();
          parts.push(`![${alt}](${src})`);
        }
      }
      if (caption) parts.push(`*${caption}*`);
      if (!parts.length) return "";
      return `\n\n${parts.join("\n\n")}\n\n`;
    }
  });

  // Links with no usable target or no text are dropped instead of leaving []().
  service.addRule("mwvAnchor", {
    filter: "a",
    replacement: (content: string, node: Node): string => {
      const element = node as HTMLAnchorElement;
      const href = (element.getAttribute("href") ?? "").trim();
      const label = content.replace(/\s+/g, " ").trim();
      if (!href || /^javascript:/i.test(href)) return label;
      if (!label) return href.startsWith("#") ? "" : `<${href}>`;
      if (href.startsWith("#") || label === href) return label;
      return `[${label}](${href.replace(/\)/g, "%29")})`;
    }
  });

  // Media that Markdown cannot carry gets downgraded to a link.
  service.addRule("mwvMedia", {
    filter: (node: Node): boolean => ["VIDEO", "AUDIO", "SOURCE"].includes(node.nodeName),
    replacement: (_content: string, node: Node): string => {
      const element = node as HTMLElement;
      const src = element.getAttribute("src") ?? element.querySelector("source")?.getAttribute("src") ?? "";
      if (!src) return "";
      return `\n\n[${element.nodeName === "AUDIO" ? "Audio" : "Video"}](${src})\n\n`;
    }
  });

  return service;
}

function detectCodeLanguage(element: Element): string {
  const raw = [
    element.getAttribute("class") ?? "",
    element.getAttribute("data-lang") ?? "",
    element.getAttribute("data-language") ?? "",
    element.getAttribute("lang") ?? ""
  ].join(" ");
  const match = /(?:language|lang|brush|highlight)[-: _]([a-z0-9+#._-]+)/i.exec(raw);
  return match ? match[1].toLowerCase() : "";
}

let sharedTurndown: TurndownService | null = null;

function turndown(): TurndownService {
  if (!sharedTurndown) sharedTurndown = createTurndownService();
  return sharedTurndown;
}

function collapseMarkdown(markdown: string): string {
  return markdown
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+/, "")
    .replace(/\s+$/, "");
}

export function htmlToMarkdown(html: string, baseUrl: string): string {
  if (!html.trim()) return "";
  const wrapped = `<div id="mwv-reader-root">${html}</div>`;
  const parsed = new DOMParser().parseFromString(wrapped, "text/html");
  if (baseUrl) absolutize(parsed.getElementById("mwv-reader-root"), baseUrl);
  const root = parsed.getElementById("mwv-reader-root");
  if (!root) return "";
  return collapseMarkdown(turndown().turndown(root.innerHTML));
}

/** Turns "/a.png" and relative links into absolute URLs against `baseUrl`. */
export function absolutize(root: Element | null, baseUrl: string): void {
  if (!root || !baseUrl) return;
  const resolve = (value: string | null): string => {
    const raw = (value ?? "").trim();
    if (!raw) return "";
    if (/^(?:mailto:|tel:|javascript:|data:|blob:)/i.test(raw)) return raw;
    try {
      return new URL(raw, baseUrl).toString();
    } catch {
      return raw;
    }
  };
  root.querySelectorAll("a[href]").forEach((anchor) => {
    const resolved = resolve(anchor.getAttribute("href"));
    if (resolved) anchor.setAttribute("href", resolved);
    else anchor.removeAttribute("href");
  });
  root.querySelectorAll("img").forEach((image) => {
    const raw =
      image.getAttribute("src") ||
      image.getAttribute("data-src") ||
      image.getAttribute("data-original") ||
      image.getAttribute("data-lazy-src") ||
      "";
    const resolved = resolve(raw);
    if (resolved && !/^(?:data:|blob:)/i.test(resolved)) {
      // Mirror the guest-side pass: an https page's http:// images are blocked
      // by the CSP and render broken, so upgrade them.
      const upgraded = /^http:\/\//i.test(resolved) && /^https:/i.test(baseUrl) ? `https://${resolved.slice(7)}` : resolved;
      image.setAttribute("src", upgraded);
    } else {
      image.removeAttribute("src");
    }
  });
}

export function stripReaderNoise(root: ParentNode): void {
  root.querySelectorAll(READER_DROP_SELECTORS.join(",")).forEach((node) => {
    if (node.parentNode) node.parentNode.removeChild(node);
  });
  // Comments carry no content but do slow the scorer down.
  const walker = (root as Document).createTreeWalker?.(root as Node, NodeFilter.SHOW_COMMENT);
  if (!walker) return;
  const comments: Comment[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode as Comment);
  for (const comment of comments) comment.parentNode?.removeChild(comment);
}

/** Parses fetched HTML, with the base URL Readability needs to resolve links. */
export function documentFromHtml(html: string, url: string): Document {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (url && !doc.querySelector("base")) {
    const head = doc.head ?? doc.querySelector("head");
    if (head) {
      const base = doc.createElement("base");
      base.setAttribute("href", url);
      head.insertBefore(base, head.firstChild);
    }
  }
  return doc;
}

/**
 * Readability pass over fetched HTML. Returns null when the page is a wall,
 * an app shell, or simply not an article — the caller then tries the live DOM.
 */
export function extractArticleFromHtml(html: string, url: string): ReaderArticle | null {
  if (!html.trim() || looksLikeBlockedPage(html)) return null;
  try {
    const doc = documentFromHtml(html, url);
    stripReaderNoise(doc);
    const article = new Readability(doc, {
      charThreshold: READER_CHAR_THRESHOLD,
      keepClasses: false
    }).parse();
    if (!article?.content) return null;
    return finalizeArticle(
      {
        title: article.title ?? "",
        byline: article.byline ?? "",
        siteName: article.siteName ?? "",
        publishedTime: article.publishedTime ?? "",
        excerpt: article.excerpt ?? "",
        lang: article.lang ?? "",
        dir: article.dir ?? "",
        html: article.content,
        text: (article.textContent ?? "").trim(),
        length: article.length ?? 0
      },
      url
    );
  } catch (error) {
    console.warn("[mobile-webviewer] readability pass skipped", error);
    return null;
  }
}

/**
 * Turns a payload returned by the injected guest script into the same shape,
 * so the reader panel cannot tell the two paths apart.
 */
export function articleFromLivePayload(payload: LiveReaderPayload | null | undefined, fallbackUrl: string): ReaderArticle | null {
  if (!payload || typeof payload !== "object") return null;
  if (!payload.ok || typeof payload.html !== "string" || !payload.html.trim()) return null;
  const baseUrl = typeof payload.baseUrl === "string" && payload.baseUrl ? payload.baseUrl : fallbackUrl;
  return finalizeArticle(
    {
      title: typeof payload.title === "string" ? payload.title : "",
      byline: typeof payload.byline === "string" ? payload.byline : "",
      siteName: typeof payload.siteName === "string" ? payload.siteName : "",
      publishedTime: typeof payload.publishedTime === "string" ? payload.publishedTime : "",
      excerpt: typeof payload.excerpt === "string" ? payload.excerpt : "",
      lang: typeof payload.lang === "string" ? payload.lang : "",
      dir: typeof payload.dir === "string" ? payload.dir : "",
      html: payload.html,
      text: typeof payload.text === "string" ? payload.text : "",
      length: typeof payload.length === "number" ? payload.length : 0
    },
    baseUrl,
    "live"
  );
}

function finalizeArticle(
  raw: Omit<ReaderArticle, "markdown" | "method">,
  baseUrl: string,
  method: ReaderArticle["method"] = "readability"
): ReaderArticle | null {
  const html = raw.html.trim();
  if (!html) return null;
  const markdown = htmlToMarkdown(html, baseUrl);
  if (!markdown) return null;
  const text = raw.text || markdown.replace(/[#>*`~|]/g, " ").replace(/\s+/g, " ").trim();
  return {
    title: raw.title.trim(),
    byline: raw.byline.trim(),
    siteName: raw.siteName.trim(),
    publishedTime: raw.publishedTime.trim(),
    excerpt: (raw.excerpt || text).slice(0, 420),
    lang: raw.lang,
    dir: raw.dir,
    html,
    text,
    markdown,
    length: raw.length || text.length,
    method
  };
}

/** Human-readable reason for the reader panel / console when nothing worked. */
export function describeReaderFailure(reason: string): string {
  return reason || "no readable content";
}
