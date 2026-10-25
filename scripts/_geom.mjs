import fs from "node:fs";
import * as esbuild from "esbuild";

const source = fs.readFileSync("main.ts", "utf8");
function findBodyEnd(src, braceStart) {
  let depth = 0;
  let i = braceStart;
  let mode = "code";
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && n === "*") { mode = "block"; i += 2; continue; }
      if (c === "'") { mode = "sq"; i++; continue; }
      if (c === '"') { mode = "dq"; i++; continue; }
      if (c === "`") { mode = "tpl"; i++; continue; }
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) return i; }
      i++;
      continue;
    }
    if (mode === "line") { if (c === "\n") mode = "code"; i++; continue; }
    if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i += 2; continue; } i++; continue; }
    if (mode === "sq" || mode === "dq") {
      const q = mode === "sq" ? "'" : '"';
      if (c === "\\") { i += 2; continue; }
      if (c === q) mode = "code";
      i++;
      continue;
    }
    if (mode === "tpl") { if (c === "\\") { i += 2; continue; } if (c === "`") mode = "code"; i++; continue; }
  }
  throw new Error("unterminated");
}
function extractMethod(src, name) {
  const re = new RegExp(`^  (?:private |public |protected )?(async )?${name}\\s*\\(`, "m");
  const m = re.exec(src);
  if (!m) throw new Error("missing " + name);
  const parenStart = src.indexOf("(", m.index);
  const end = findBodyEnd(src, src.indexOf("{", parenStart));
  return { isAsync: Boolean(m[1]), paramsAndBody: src.slice(parenStart, end + 1) };
}
const names = [
  "normalizeInkText", "inkTextMatches", "markdownLineBlocks", "markdownLineKind",
  "alignWebBlocksToMarkdown", "anchorInkToMarkdownLines", "applyInkLineAnchors",
  "markdownRenderMetrics", "inkLineToFraction"
];
const entries = names.map((name) => {
  const e = extractMethod(source, name);
  return `  ${name}: ${e.isAsync ? "async " : ""}function${e.paramsAndBody}`;
});
const js = esbuild.transformSync(`const __X = {\n${entries.join(",\n")}\n};\n__X;`, {
  loader: "ts", format: "cjs", target: "es2020"
}).code;
const table = new Function(`${js}\nreturn __X;`)();

const mdPath = "/var/minis/mounts/hojjat/note/Mobile Webviewer Notes/摩尔斯电码详解-CSDN博客.md";
const markdown = fs.readFileSync(mdPath, "utf8");
const lines = markdown.split("\n");
const metrics = table.markdownRenderMetrics(markdown, 40);
console.log(`lines ${lines.length} · units ${metrics.total.toFixed(1)} · images ${metrics.imageCount} · docPx ${Math.round(metrics.totalPx)}`);

// Where would a stroke drawn beside paragraph X end up?
const probes = [
  { note: "摩尔斯电码是一种时通时断", page: 0.03 },
  { note: "摩尔斯电码由两种基本信号组成", page: 0.15 },
  { note: "摩斯码发错了怎么办", page: 0.25 },
  { note: "国际摩尔斯电码救难信号", page: 0.45 },
  { note: "中文与摩斯电码", page: 0.90 },
  { note: "很明显，无论对编码者还是对解码者", page: 0.97 }
];
const mdBlocks = table.markdownLineBlocks(markdown);
const findLine = (needle) => {
  const block = mdBlocks.find((item) => item.text.includes(needle));
  return block ? block.start : -1;
};
// The note's own geometry says where each of those lines will really be.
console.log("\nparagraph                       note line   true fraction   page fraction");
for (const probe of probes) {
  const line = findLine(probe.note);
  if (line < 0) { console.log(`${probe.note.padEnd(30)} not found`); continue; }
  const fraction = table.inkLineToFraction(line, metrics);
  console.log(`${probe.note.slice(0, 28).padEnd(30)} ${String(line).padEnd(11)} ${fraction.toFixed(3).padEnd(14)} ${probe.page}`);
}
const oldStart = 6 / lines.length;
const newStart = table.inkLineToFraction(6, metrics);
console.log(`\nfirst body content: page-space assumption ${oldStart.toFixed(3)} → note-space ${newStart.toFixed(3)} (push down ${((newStart - oldStart) * 100).toFixed(1)}% of the document)`);
