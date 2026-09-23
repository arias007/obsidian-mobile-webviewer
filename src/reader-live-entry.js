/*
 * Entry point for the script the host injects into the guest page.
 *
 * It runs INSIDE the rendered document, which is the whole point. Pages such
 * as baike.baidu.com, zhihu.com and 36kr.com answer a plain HTTP fetch with a
 * "安全验证" wall or an empty app shell, while the real Chromium render shows
 * the full article. Readability — Mozilla's reader-mode algorithm, the one
 * Firefox ships — scores that rendered DOM and returns the article.
 *
 * The result is HTML plus metadata. The host turns it into Markdown with
 * Turndown so headings, images, tables and code blocks survive the trip.
 *
 * Everything here has to be self-contained: this file is bundled into a
 * single expression string and evaluated in the guest, so it may not import
 * anything else.
 */
import { Readability } from "@mozilla/readability";

/** Nodes that never carry article text and only pollute the Markdown. */
/**
 * Embedded players are real content: a tutorial page's YouTube/Bilibili video
 * is part of the article, not chrome. Every other iframe (ads, widgets,
 * tracking) is dropped. The host converts kept players into plain links.
 */
var VIDEO_IFRAME_MARKERS = [
  "youtube.com/embed",
  "youtube-nocookie.com/embed",
  "youtu.be/",
  "player.bilibili.com/player.html",
  "bilibili.com/blackboard/html5mobileplayer",
  "player.vimeo.com/video",
  "www.dailymotion.com/embed",
  "player.youku.com/embed",
  "v.qq.com/txp/iframe/player"
];

function isVideoIframe(node) {
  if (!node || node.nodeName !== "IFRAME") return false;
  var src = node.getAttribute("src") || "";
  if (!src) return false;
  for (var i = 0; i < VIDEO_IFRAME_MARKERS.length; i++) {
    if (src.indexOf(VIDEO_IFRAME_MARKERS[i]) !== -1) return true;
  }
  return false;
}

var STRIP_SELECTORS = [
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
].join(",");

/** Attribute-level chrome that Turndown would otherwise leak into output. */
var STRIP_ATTRIBUTES = [
  "style",
  "class",
  "id",
  "role",
  "tabindex",
  "onclick",
  "onload",
  "onerror",
  "loading",
  "decoding",
  "fetchpriority",
  "data-srcset",
  "srcset",
  "sizes"
];

function stripAttributes(root) {
  var nodes = root.querySelectorAll("*");
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    for (var a = 0; a < STRIP_ATTRIBUTES.length; a++) {
      el.removeAttribute(STRIP_ATTRIBUTES[a]);
    }
  }
}

function stripNodes(root) {
  var doomed;
  try {
    doomed = root.querySelectorAll(STRIP_SELECTORS);
  } catch (error) {
    return;
  }
  for (var i = doomed.length - 1; i >= 0; i--) {
    var node = doomed[i];
    // Embedded video players survive: the host turns them into watch links.
    if (isVideoIframe(node)) continue;
    if (node.parentNode) node.parentNode.removeChild(node);
  }
}

/** Absolute-ise every link and image so the Markdown survives leaving the page. */
function absoluteize(root, baseUrl) {
  if (!baseUrl) return;
  var resolve = function (value) {
    if (!value) return "";
    var raw = String(value).trim();
    if (!raw || raw.charAt(0) === "#") return raw;
    if (/^(?:mailto:|tel:|javascript:|data:|blob:)/i.test(raw)) return raw;
    try {
      return new URL(raw, baseUrl).toString();
    } catch (error) {
      return raw;
    }
  };
  var links = root.querySelectorAll("a[href]");
  for (var i = 0; i < links.length; i++) {
    var href = links[i].getAttribute("href");
    var resolved = resolve(href);
    if (resolved) links[i].setAttribute("href", resolved);
    else links[i].removeAttribute("href");
  }
  var images = root.querySelectorAll("img");
  for (var j = 0; j < images.length; j++) {
    var img = images[j];
    var src =
      img.getAttribute("src") ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-original") ||
      img.getAttribute("data-lazy-src") ||
      "";
    if (!src) {
      // Some lazy loaders keep the real URL only in srcset; take the widest.
      var srcset = img.getAttribute("data-srcset") || img.getAttribute("srcset") || "";
      var parts = srcset.split(",");
      src = (parts[parts.length - 1] || "").trim().split(/\s+/)[0] || "";
    }
    var absolute = resolve(src);
    if (absolute && !/^(?:data:|blob:)/i.test(absolute)) {
      // An https page may not reference http:// images: the guest CSP blocks
      // them ("Mixed Content"), and the rendered Markdown would carry broken
      // images. Image CDNs overwhelmingly serve https, so upgrade.
      if (/^http:\/\//i.test(absolute) && /^https:/i.test(baseUrl)) absolute = "https://" + absolute.slice(7);
      img.setAttribute("src", absolute);
    } else {
      img.removeAttribute("src");
    }
  }
}

function textOf(root) {
  var text = root.textContent || "";
  return text.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Last resort when Readability refuses a page (index pages, galleries, search
 * results). Keeps the densest block of the rendered body instead of shipping
 * nothing at all.
 */
function fallbackHtml(live, baseUrl) {
  var body = live.body;
  if (!body) return "";
  var clone = body.cloneNode(true);
  stripNodes(clone);
  var best = null;
  var bestScore = 0;
  var blocks = clone.querySelectorAll("article, main, [role='main'], section, div");
  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    var score = textOf(block).length;
    if (score > bestScore) {
      bestScore = score;
      best = block;
    }
  }
  var target = best && bestScore > 200 ? best : clone;
  stripAttributes(target);
  absoluteize(target, baseUrl);
  return target.innerHTML || "";
}

globalThis.__mwvReadLive = function (options) {
  var opts = options || {};
  var minChars = typeof opts.minChars === "number" ? opts.minChars : 220;
  var result = {
    ok: false,
    reason: "",
    method: "",
    title: "",
    byline: "",
    siteName: "",
    publishedTime: "",
    excerpt: "",
    lang: "",
    dir: "",
    html: "",
    text: "",
    length: 0,
    baseUrl: ""
  };

  try {
    var live = document;
    if (!live || !live.body) {
      result.reason = "no-body";
      return result;
    }
    var baseUrl = "";
    try {
      baseUrl = live.baseURI || (live.location && live.location.href) || "";
    } catch (error) {
      baseUrl = "";
    }
    result.baseUrl = baseUrl;
    result.title = (live.title || "").trim();

    // Readability rewrites the tree it is handed, so hand it a copy: the page
    // the user is looking at must not be touched.
    var clone = live.cloneNode(true);
    // A detached clone loses its base URL, which is what Readability uses to
    // turn "/img/x.png" into an absolute URL. Re-attach it explicitly.
    try {
      var head = clone.querySelector("head");
      if (head && baseUrl && !clone.querySelector("base")) {
        var base = live.createElement("base");
        base.setAttribute("href", baseUrl);
        head.insertBefore(base, head.firstChild);
      }
    } catch (error) {
      /* a missing head is not fatal: the host absolute-ises as well */
    }
    stripNodes(clone);

    var article = null;
    try {
      article = new Readability(clone, { charThreshold: Math.max(140, minChars) }).parse();
    } catch (error) {
      result.reason = "readability:" + (error && error.message ? error.message : String(error));
      article = null;
    }

    if (article && article.content) {
      var body = live.createElement("div");
      body.innerHTML = article.content;
      stripNodes(body);
      stripAttributes(body);
      absoluteize(body, baseUrl);
      var text = textOf(body);
      if (text.length >= minChars) {
        result.ok = true;
        result.method = "readability";
        result.title = (article.title || result.title || "").trim();
        result.byline = (article.byline || "").trim();
        result.siteName = (article.siteName || "").trim();
        result.publishedTime = (article.publishedTime || "").trim();
        result.excerpt = (article.excerpt || "").trim();
        result.lang = (article.lang || "").trim();
        result.dir = (article.dir || "").trim();
        result.html = body.innerHTML || "";
        result.text = text;
        result.length = article.length || text.length;
        return result;
      }
    }

    // Readability bailed (or produced a stub). Keep whatever dense content the
    // rendered page actually has rather than returning nothing.
    var fallback = fallbackHtml(live, baseUrl);
    if (fallback) {
      var probe = live.createElement("div");
      probe.innerHTML = fallback;
      var fallbackText = textOf(probe);
      if (fallbackText.length >= (opts.fallbackMinChars || 120)) {
        result.ok = true;
        result.method = result.method || "dom-fallback";
        result.html = fallback;
        result.text = fallbackText;
        result.length = fallbackText.length;
        result.excerpt = fallbackText.slice(0, 400);
        return result;
      }
    }
    result.reason = result.reason || "thin-content";
    return result;
  } catch (error) {
    result.reason = "fatal:" + (error && error.message ? error.message : String(error));
    return result;
  }
};
