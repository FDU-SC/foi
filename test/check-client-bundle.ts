import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(process.cwd(), ".next", "static");
const files: string[] = [];

function collect(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(path);
  }
}

collect(root);

// ------------------------------------------------------------------
// Structural markers: object property shapes that survive minification.
// Minifiers preserve property names; we match on those, not on variable
// names or call-site patterns that change with every bundler release.
// ------------------------------------------------------------------
const STRUCTURAL = [
  { label: "外挂后端配置 (backend.id)", pattern: /backend:\{id:"/ },
  { label: "内联判题配置 (backend.kind)", pattern: /backend:\{kind:"inline"/ },
];

// ------------------------------------------------------------------
// Auto-extracted markers from server-only source files.
// We read the judge modules and problem configs at check time and
// pull out distinctive strings that must never reach the client.
// ------------------------------------------------------------------

const contentRoot = join(process.cwd(), "content", "problems");

function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

interface Marker {
  label: string;
  value: string;
}

function extractJudgeExports(): Marker[] {
  const markers: Marker[] = [];
  const judgeDir = join(contentRoot, "_shared", "judge");

  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(judgeDir, { withFileTypes: true });
  } catch {
    return markers;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;

    const source = readIfExists(join(judgeDir, entry.name));
    if (!source) continue;

    // Only check files that declare server-only
    if (!source.includes('"server-only"')) continue;

    // Extract exported function/const names like `judgeRoulette`, `judgeOutputOnly`
    const exportedNames = [
      ...source.matchAll(/export\s+(?:const|function)\s+(\w+)/g),
    ].map((m) => m[1]);

    for (const name of exportedNames) {
      // Skip type-only exports and very short/generic names
      if (name.length < 8) continue;
      markers.push({
        label: `判题函数 ${name} (${entry.name})`,
        value: name,
      });
    }
  }

  return markers;
}

function extractInlineAnswers(): Marker[] {
  const markers: Marker[] = [];

  let dirs: import("node:fs").Dirent[];
  try {
    dirs = readdirSync(contentRoot, { withFileTypes: true });
  } catch {
    return markers;
  }

  for (const dir of dirs) {
    if (!dir.isDirectory() || dir.name.startsWith("_")) continue;

    const problemPath = join(contentRoot, dir.name, "problem.ts");
    const source = readIfExists(problemPath);
    if (!source) continue;

    // Only care about inline-judged problems
    if (!source.includes('kind: "inline"') && !source.includes("kind: 'inline'")) continue;

    const rel = relative(process.cwd(), problemPath);

    // Extract `expected:` string values — these are answer keys
    for (const match of source.matchAll(/expected:\s*"([^"]+)"/g)) {
      const value = match[1];
      if (value.length < 2) continue;
      markers.push({
        label: `答案 "${value}" (${rel})`,
        value,
      });
    }

    // Extract config objects with distinctive scoring constants.
    // Values like `scoreNumber: 100` are too generic; skip those.
    // But `scoreColor: 30` paired with `scoreSize: 10` together are distinctive.
    for (const match of source.matchAll(
      /(\w+Config)\s*,?\s*$/gm,
    )) {
      markers.push({
        label: `内联配置类型 ${match[1]} (${rel})`,
        value: match[1],
      });
    }
  }

  return markers;
}

const judgeMarkers = extractJudgeExports();
const answerMarkers = extractInlineAnswers();

const findings: string[] = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const short = relative(join(process.cwd(), ".next"), file);

  for (const { label, pattern } of STRUCTURAL) {
    if (pattern.test(source)) {
      findings.push(`${label}: ${short}`);
    }
  }

  for (const marker of [...judgeMarkers, ...answerMarkers]) {
    if (source.includes(marker.value)) {
      findings.push(`${marker.label}: ${short}`);
    }
  }
}

if (findings.length > 0) {
  console.error("客户端产物包含仅应存在于服务端的内容：");
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exitCode = 1;
} else {
  const total = STRUCTURAL.length + judgeMarkers.length + answerMarkers.length;
  console.log(
    `客户端边界检查通过（扫描 ${files.length} 个 JavaScript 文件，` +
      `${STRUCTURAL.length} 条结构 marker + ` +
      `${judgeMarkers.length} 条判题函数 + ` +
      `${answerMarkers.length} 条答案 marker = ${total} 条）`,
  );
}
