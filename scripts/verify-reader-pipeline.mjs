/**
 * End-to-end check of the new reader pipeline against real pages.
 *
 * It bundles src/reader.ts the same way the plugin build does, hands it a
 * jsdom DOM (the host is a browser, but jsdom is enough to prove the article
 * extraction and the Markdown conversion), and asserts on the output.
 *
 * Usage: node scripts/verify-reader-pipeline.mjs [--fetch]
 *   --fetch  download the sample pages first (needs network)
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import esbuild from "esbuild";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const fixtureDir = path.resolve("scripts/fixtures");
const shouldFetch = process.argv.includes("--fetch");

const SAMPLES = [
  {
    id: "sspai",
    url: "https://sspai.com/post/78900",
    expect: { minChars: 400, needsHeading: true }
  },
  {
    id: "mdn",
    url: "https://developer.mozilla.org/en-US/docs/Web/API/Element/innerHTML",
    expect: { minChars: 400, needsCode: true }
  },
  {
    id: "runoob",
    url: "https://www.runoob.com/markdown/md-tutorial.html",
    expect: { minChars: 300, needsCode: true }
  },
  {
    id: "baike-block",
    url: "https://baike.baidu.com/item/%E7%8E%89%E6%B3%BD%E6%BC%94/102526",
    expect: { blocked: true }
  }
];

/**
 * Node's fetch transparently decompresses whatever it advertised support for,
 * and strips the header when it does. Asking for `identity` keeps the two
 * layers from fighting: anything still compressed is decoded by hand below.
 */
function decodeBody(buffer, encoding) {
  const kind = (encoding || "").toLowerCase();
  if (!kind || kind.includes("identity")) return buffer.toString("utf8");
  if (kind.includes("br")) return zlib.brotliDecompressSync(buffer).toString("utf8");
  if (kind.includes("gzip")) return zlib.gunzipSync(buffer).toString("utf8");
  if (kind.includes("deflate")) return zlib.inflateSync(buffer).toString("utf8");
  return buffer.toString("utf8");
}

if (shouldFetch) {
  fs.mkdirSync(fixtureDir, { recursive: true });
  for (const sample of SAMPLES) {
    const file = path.join(fixtureDir, `${sample.id}.html`);
    try {
      const response = await fetch(sample.url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          "accept-encoding": "identity"
        },
        redirect: "follow"
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      let body = "";
      try {
        body = decodeBody(buffer, response.headers.get("content-encoding"));
      } catch (error) {
        console.log(`decode failed for ${sample.id}: ${error.message}`);
        continue;
      }
      const plausible = /<html|<head|<body|<!doctype/i.test(body.slice(0, 4000));
      if (!plausible) {
        console.log(`skipped ${sample.id}: response is not HTML (${body.length} bytes) - keeping previous fixture`);
        continue;
      }
      fs.writeFileSync(file, body, "utf8");
      console.log(`fetched ${sample.id}: ${response.status} ${body.length} bytes`);
    } catch (error) {
      console.log(`fetch failed for ${sample.id}: ${error.message}`);
    }
  }
}

// Bundle the plugin's reader module to CJS so Node can run it directly.
const build = await esbuild.build({
  entryPoints: ["src/reader.ts"],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2019",
  write: false,
  logLevel: "warning"
});
const bundled = build.outputFiles[0].text;
const tmpFile = path.resolve(".tmp-reader-bundle.cjs");
fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
fs.writeFileSync(tmpFile, bundled, "utf8");

// jsdom stands in for the Obsidian renderer: DOMParser + NodeFilter are enough.
const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "https://example.com/" });
globalThis.DOMParser = dom.window.DOMParser;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.Node = dom.window.Node;
globalThis.document = dom.window.document;

const reader = require(tmpFile);

let failures = 0;
const report = [];
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  report.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
};

check("reader module exposes htmlToMarkdown", typeof reader.htmlToMarkdown === "function");
check("reader module exposes extractArticleFromHtml", typeof reader.extractArticleFromHtml === "function");
check("reader module exposes live script bundle", typeof reader.READER_LIVE_SCRIPT === "string" && reader.READER_LIVE_SCRIPT.includes("__mwvReadLive"));
check(
  "live script bundle is self-contained",
  !/require\(|import\s/.test(reader.READER_LIVE_SCRIPT.replace(/"[^"]*"/g, "")),
  `${Math.round(reader.READER_LIVE_SCRIPT.length / 1024)} KB`
);

// The blocked-page detector must catch the wall baike.baidu.com actually serves.
check("blocks the baidu 安全验证 interstitial", reader.looksLikeBlockedPage("<html><head><title>百度安全验证</title></head><body></body></html>"));
check("does not flag a real article", !reader.looksLikeBlockedPage("<html><body><h1>标题</h1><p>正文内容</p></body></html>"));

// Markdown conversion quality on a hand-written article.
const articleHtml = `
  <article>
    <h1>测试标题</h1>
    <p>第一段，包含<strong>加粗</strong>和<em>斜体</em>，以及<a href="/rel/path">一个相对链接</a>。</p>
    <h2>代码</h2>
    <pre><code class="language-python">def hello():
    print("hi")</code></pre>
    <figure>
      <img src="/img/pic.png" alt="示意图">
      <figcaption>图 1 说明</figcaption>
    </figure>
    <table>
      <thead><tr><th>名称</th><th>值</th></tr></thead>
      <tbody><tr><td>甲</td><td>1</td></tr><tr><td>乙</td><td>2</td></tr></tbody>
    </table>
    <ul><li>项目一</li><li>项目二</li></ul>
    <ul><li><input type="checkbox" checked>已完成项</li><li><input type="checkbox">待办项</li></ul>
    <blockquote><p>引用内容</p></blockquote>
  </article>`;

const markdown = reader.htmlToMarkdown(articleHtml, "https://example.com/post/1");
check("markdown keeps headings as ATX", /^# 测试标题$/m.test(markdown) && /^## 代码$/m.test(markdown));
check("markdown keeps bold and italic", markdown.includes("**加粗**") && markdown.includes("*斜体*"));
check("markdown absolutises relative links", markdown.includes("(https://example.com/rel/path)"));
check("markdown fences code with its language", /```python\n/.test(markdown));
check("markdown prefixes an image", markdown.includes("![示意图](https://example.com/img/pic.png)"));
check("markdown keeps figure captions", markdown.includes("*图 1 说明*"));
check("markdown emits a GFM table", /\|\s*名称\s*\|\s*值\s*\|/.test(markdown) && /\|\s*---\s*\|/.test(markdown));
check("markdown keeps list items compact", /^- 项目一$/m.test(markdown) && /^- 项目二$/m.test(markdown));
check("markdown keeps GFM task lists", /^- \[x\] 已完成项$/m.test(markdown) && /^- \[ \] 待办项$/m.test(markdown));
check("markdown keeps blockquotes", /^> 引用内容$/m.test(markdown));
check("markdown has no triple blank lines", !/\n{3,}/.test(markdown));

// Failure-page recognition: a saved failure used to shadow every later visit
// of the same URL, so the guard must match the exact failure shapes the reader
// produces and never a real article.
check("failure guard: empty content counts as failure", reader.looksLikeReaderFailure("") && reader.looksLikeReaderFailure(null));
check(
  "failure guard: matches the quoted-hint fallback page",
  reader.looksLikeReaderFailure([
    "# baike.baidu.com",
    "",
    "> 加载失败，重试",
    "",
    "HTTP response is blocked or empty; reading the rendered page instead",
    "",
    "https://baike.baidu.com/item/x"
  ].join("\n"))
);
check(
  "failure guard: matches the legacy no-body error",
  reader.looksLikeReaderFailure("# baike.baidu.com\n\nNo readable document body\n\nhttps://baike.baidu.com/item/x")
);
check(
  "failure guard: a real article never matches",
  !reader.looksLikeReaderFailure(markdown),
  "the hand-written article fixture must not be treated as a failure page"
);
check(
  "failure guard: a short page ending in a URL without a quote is kept",
  !reader.looksLikeReaderFailure("联系方式\n\nadmin@example.com\n\nhttps://example.com/contact")
);

// ---------------------------------------------------------------------------
// Rich-text fusion: what a page carries beyond plain paragraphs — highlights,
// video embeds, collapsed sections, math, merged tables, citation noise —
// has to survive the HTML->Markdown trip the way a real clipper keeps it.
// ---------------------------------------------------------------------------
const richHtml = `
  <article>
    <h1>富文本</h1>
    <p>这是<mark>重点内容</mark>，引用<sup>[1]</sup>标注，数学 <math><semantics><mrow><mi>a</mi></mrow><annotation encoding="application/x-tex">a^2+b^2=c^2</annotation></semantics></math> 公式。</p>
    <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" width="560" height="315"></iframe>
    <iframe src="https://player.bilibili.com/player.html?bvid=BV1xx411c7mD"></iframe>
    <iframe src="https://ads.example.com/tracker?foo=1"></iframe>
    <video src="https://example.com/clip.mp4"></video>
    <details><summary>展开查看</summary><p>被折叠的正文</p></details>
    <table>
      <tr><th rowspan="2">项目</th><th colspan="2">数值</th></tr>
      <tr><td>甲</td><td>乙</td></tr>
      <tr><td>合计</td><td>1</td><td>2</td></tr>
    </table>
  </article>`;
const rich = reader.htmlToMarkdown(richHtml, "https://example.com/rich/1");
check("rich: <mark> becomes Obsidian ==highlight==", rich.includes("==重点内容=="));
check("rich: numeric citation sup is dropped", !rich.includes("[1]"));
check("rich: TeX annotation becomes inline math", rich.includes("$a^2+b^2=c^2$"));
check("rich: YouTube iframe becomes a watch link", rich.includes("[Video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)"));
check("rich: Bilibili iframe becomes a video-page link", rich.includes("https://www.bilibili.com/video/BV1xx411c7mD"));
check("rich: non-video iframe is dropped", !rich.includes("ads.example.com"));
check("rich: <video> keeps a media link", rich.includes("[Video](https://example.com/clip.mp4)"));
check("rich: <summary> becomes a bold line", rich.includes("**展开查看**"));
check("rich: details body is kept", rich.includes("被折叠的正文"));
check("rich: merged table cells are duplicated into the grid", /项目.*甲.*乙/m.test(rich) && /项目.*数值/m.test(rich) && rich.split("\n").filter((l) => l.includes("合计")).length === 1);
check("rich: flattened table stays a GFM table", /\|\s*---\s*\|/.test(rich));

// iframe whitelisting on the extraction path: a page whose only content is a
// video embed must survive both strip passes, a widget iframe must not.
check(
  "stripReaderNoise keeps video iframes and drops widget iframes",
  (() => {
    const doc = new DOMParser().parseFromString(
      `<div id="r"><iframe src="https://player.vimeo.com/video/123"></iframe><iframe src="https://widget.example.com/x"></iframe></div>`,
      "text/html"
    );
    reader.stripReaderNoise(doc);
    const kept = doc.querySelectorAll("iframe").length;
    return kept === 1 && doc.querySelector("iframe")?.getAttribute("src") === "https://player.vimeo.com/video/123";
  })()
);

// ---------------------------------------------------------------------------
// The guest-side path: this is the one that reads anti-bot and app-shell pages,
// so it has to be proven to actually execute in a page context, not just to
// bundle. jsdom stands in for the Chromium renderer; the script is evaluated
// the way Electron evaluates it (one expression string, value returned).
// ---------------------------------------------------------------------------
const liveFixture = path.join(fixtureDir, "sspai.html");
if (fs.existsSync(liveFixture)) {
  const JSDOMLive = JSDOM;
  const guest = new JSDOMLive(fs.readFileSync(liveFixture, "utf8"), {
    url: "https://sspai.com/post/78900",
    runScripts: "dangerously",
    pretendToBeVisual: true
  });
  let payload = null;
  try {
    payload = guest.window.eval(
      `${reader.READER_LIVE_SCRIPT}\n__mwvReadLive(${JSON.stringify({ minChars: 220, fallbackMinChars: 120 })});`
    );
  } catch (error) {
    check("live script evaluates inside a page context", false, error.message);
  }
  if (payload) {
    check("live script evaluates inside a page context", true);
    check("live script reports success on a real article", payload.ok === true, `reason=${payload.reason ?? ""} method=${payload.method}`);
    check("live script extracts a substantial article", (payload.text ?? "").length > 400, `${(payload.text ?? "").length} chars`);
    check("live script returns article HTML for the host to convert", typeof payload.html === "string" && payload.html.length > 200);
    check("live script reports the page base URL", payload.baseUrl === "https://sspai.com/post/78900", payload.baseUrl ?? "");
    check(
      "live script leaves no relative links behind",
      !/(?:href|src)="\/(?!\/)/.test(payload.html ?? ""),
      "relative href/src would break once rendered outside the guest"
    );
    check("live script keeps the page title", (payload.title ?? "").length > 0, (payload.title ?? "").slice(0, 50));
    // The host must be able to turn that payload into the same Markdown as the
    // HTTP path — that equivalence is what makes both paths interchangeable.
    const liveArticle = reader.articleFromLivePayload(payload, "https://sspai.com/post/78900");
    check("host converts the live payload to Markdown", !!liveArticle && liveArticle.markdown.length > 400, `${liveArticle?.markdown.length ?? 0} chars`);
    check("live payload is marked as coming from the live page", liveArticle?.method === "live", liveArticle?.method ?? "");
    check("live payload for a blocked page is rejected", reader.articleFromLivePayload({ ok: false, reason: "thin-content" }, "https://x/") === null);
  }
  guest.window.close();
} else {
  report.push("SKIP  live script execution (no sspai fixture; run with --fetch)");
}

// Low-threshold regression: a page whose summary block alone satisfies the
// first Readability pass must not stop there — the adaptive second pass has
// to climb and carry the sections, table and summary together.
const synthetic = new JSDOM(
  [
    "<!doctype html><html><head><title>合成页</title></head><body>",
    '<nav>导航菜单 ', "导航链接文字。".repeat(60), '</nav>',
    '<div class="summary"><p>', "这是词条的摘要段落，概括全篇。".repeat(40), "</p></div>",
    '<div class="lemma-main">',
    ...[1, 2, 3, 4].map((n) => `<h2>第${["一","二","三","四"][n - 1]}节</h2><p>${`第${["一","二","三","四"][n - 1]}节正文内容详细叙述。`.repeat(24)}</p>`),
    "<table><tr><th>项目</th><td>表格数据甲乙丙丁。</td></tr></table>",
    "</div>",
    '<aside>侧栏推荐 ', "侧栏链接文字。".repeat(60), '</aside>',
    '<footer>页脚 ', "页脚版权文字。".repeat(50), '</footer>',
    "</body></html>"
  ].join(""),
  { url: "https://example.com/synthetic/1", runScripts: "dangerously", pretendToBeVisual: true }
);
try {
  const synPayload = synthetic.window.eval(
    `${reader.READER_LIVE_SCRIPT}\n__mwvReadLive(${JSON.stringify({ minChars: 220, fallbackMinChars: 120 })});`
  );
  if (synPayload) {
    check("adaptive live pass keeps the summary block", synPayload.ok === true && (synPayload.text ?? "").includes("概括全篇"), `text=${(synPayload.text ?? "").length} chars`);
    check("adaptive live pass reaches the later sections", (synPayload.text ?? "").includes("第四节"), "");
    check("adaptive live pass keeps the table", (synPayload.text ?? "").includes("表格数据甲乙丙丁"), "");
    check("adaptive live pass beats the summary-only stub", (synPayload.text ?? "").length > 1200, `${(synPayload.text ?? "").length} chars`);
  }
} finally {
  synthetic.window.close();
}

for (const sample of SAMPLES) {
  const file = path.join(fixtureDir, `${sample.id}.html`);
  if (!fs.existsSync(file)) {
    report.push(`SKIP  ${sample.id} (no fixture; run with --fetch)`);
    continue;
  }
  const html = fs.readFileSync(file, "utf8");
  if (sample.expect.blocked) {
    const article = reader.extractArticleFromHtml(html, sample.url);
    check(`${sample.id}: blocked page yields no article (host defers to live DOM)`, article === null);
    continue;
  }
  const article = reader.extractArticleFromHtml(html, sample.url);
  if (!article) {
    check(`${sample.id}: article extracted`, false, "reader returned null");
    continue;
  }
  check(`${sample.id}: article extracted`, true, `${article.markdown.length} markdown chars, method=${article.method}`);
  check(
    `${sample.id}: markdown is substantial`,
    article.markdown.length >= sample.expect.minChars,
    `${article.markdown.length} chars`
  );
  if (sample.expect.needsHeading) {
    check(`${sample.id}: markdown has a heading`, /^#{1,3} /m.test(article.markdown));
  }
  if (sample.expect.needsCode) {
    check(`${sample.id}: markdown has a code fence`, /```/.test(article.markdown));
  }
  check(`${sample.id}: title resolved`, article.title.length > 0, article.title.slice(0, 60));
}

fs.rmSync(tmpFile, { force: true });

console.log(report.join("\n"));
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
