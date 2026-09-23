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

/**
 * One Readability pass over a fresh clone of the live DOM. Readability
 * rewrites the tree it is handed, so each attempt needs its own copy; the
 * base URL is re-attached because a detached clone loses it.
 */
function parseWithReadability(live, baseUrl, threshold) {
  var clone = live.cloneNode(true);
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
  try {
    return new Readability(clone, { charThreshold: threshold }).parse();
  } catch (error) {
    return null;
  }
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

    // How much text the rendered page actually holds. Readability that comes
    // home with a fraction of this under-extracted: charThreshold is what
    // makes it climb the tree, and a low one lets it stop at the first block
    // that looks "long enough" — a baike summary stub satisfied 220 chars and
    // the catalog, tables and images above and below it were dropped.
    var bodyText = textOf(live.body);

    // Pass 1 uses Firefox's own default (500). If the result covers little of
    // the rendered page, pass 2 raises the threshold far enough that the
    // scorer has to keep climbing into the container that holds everything.
    var attempts = [Math.max(500, minChars), Math.min(20000, Math.max(2000, bodyText.length))];
    var best = null;
    for (var a = 0; a < attempts.length; a++) {
      var article = parseWithReadability(live, baseUrl, attempts[a]);
      if (!article || !article.content) continue;
      var body = live.createElement("div");
      body.innerHTML = article.content;
      stripNodes(body);
      stripAttributes(body);
      absoluteize(body, baseUrl);
      var text = textOf(body);
      if (text.length < minChars) continue;
      if (!best || text.length > best.text.length) {
        best = { article: article, body: body, text: text };
      }
      // Good enough when the page itself is short, or the article carries
      // close to everything the rendered body shows.
      if (bodyText.length < 2000 || text.length >= bodyText.length * 0.45) break;
    }

    if (best) {
      // Readability can lock onto a summary stub while the rendered page
      // holds several times more text: baike's lemma body sits in sibling
      // containers whose scores never win, and a higher charThreshold only
      // relaxes Readability's cleaning flags — it never climbs the tree. When
      // the article covers a small fraction of the rendered text, the
      // densest-block fallback carries more of the page; take whichever is
      // longer.
      var coverage = bodyText.length > 0 ? best.text.length / bodyText.length : 1;
      if (coverage < 0.45 && bodyText.length > 2000) {
        var fbHtml = fallbackHtml(live, baseUrl);
        if (fbHtml) {
          var fbProbe = live.createElement("div");
          fbProbe.innerHTML = fbHtml;
          var fbText = textOf(fbProbe);
          if (fbText.length > best.text.length * 1.3 && fbText.length >= 800) {
            result.ok = true;
            result.method = "dom-fallback";
            result.html = fbHtml;
            result.text = fbText;
            result.length = fbText.length;
            result.excerpt = fbText.slice(0, 400);
            return result;
          }
        }
      }
      result.ok = true;
      result.method = "readability";
      result.title = (best.article.title || result.title || "").trim();
      result.byline = (best.article.byline || "").trim();
      result.siteName = (best.article.siteName || "").trim();
      result.publishedTime = (best.article.publishedTime || "").trim();
      result.excerpt = (best.article.excerpt || "").trim();
      result.lang = (best.article.lang || "").trim();
      result.dir = (best.article.dir || "").trim();
      result.html = best.body.innerHTML || "";
      result.text = best.text;
      result.length = best.article.length || best.text.length;
      return result;
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
