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

const names = ["normalizeInkText", "inkTextMatches", "markdownLineBlocks", "markdownLineKind", "alignWebBlocksToMarkdown"];
const entries = names.map((name) => {
  const extracted = extractMethod(source, name);
  return `  ${name}: ${extracted.isAsync ? "async " : ""}function${extracted.paramsAndBody}`;
});
const js = esbuild.transformSync(`const __X = {\n${entries.join(",\n")}\n};\n__X;`, {
  loader: "ts", format: "cjs", target: "es2020"
}).code;
const table = new Function(`${js}\nreturn __X;`)();

const mdPath = process.argv[2];
const md = fs.readFileSync(mdPath, "utf8");
const blocks = table.markdownLineBlocks(md);
console.log("blocks:", blocks.length);
for (const block of blocks.slice(0, 14)) {
  console.log(`  [${block.start}-${block.end}] ${block.text.slice(0, 70)}`);
}

const mini = [
  "---", "a: b", "---", "", "# T", "",
  "## H2", "", "para one text here", "", "- item a", "- item b", "",
  "| c | d |", "| --- | --- |", "| 1 | 2 |", "", "tail para"
].join("\n");
console.log("mini:", JSON.stringify(table.markdownLineBlocks(mini)));
