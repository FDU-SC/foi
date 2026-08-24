/**
 * The belt. The braces are `import "server-only"` in `content/*-modules.ts`.
 *
 * That marker is what actually holds the boundary: reaching a content glob
 * from a client component fails the build, at the import, naming the file.
 * This script cannot do that — it reads minified output after the fact, and
 * every marker below is a guess about what Turbopack emits. `s.s(["problem"`
 * is its codegen shape and will stop matching at some upgrade, silently and
 * with a green build.
 *
 * So it is worth running and not worth trusting. It catches a leak that
 * arrives by a route the marker does not cover — a `NEXT_PUBLIC_` variable, a
 * value inlined into a Server Component's flight payload, a future glob added
 * without the marker — and a green result means only that these four strings
 * were absent.
 */
const { readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(process.cwd(), ".next", "static");
const files = [];

function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(path);
  }
}

collect(root);

// Strings that only exist inside a problem's `backend.config` or an enrolment
// rule, so a match means the module itself was bundled rather than the public
// projection `toPublicConfig` produces.
const forbidden = [
  { label: "题目后端配置", value: "backend:{id:" },
  { label: "题目配置模块", value: 's.s(["problem",0,{slug:' },
  { label: "测试数据路径", value: "maze-runner/v1" },
  { label: "靶机镜像名", value: "foi/chal-leaky-bucket:latest" },
  { label: "报名规则", value: "reservedHandles" },
];

const findings = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const marker of forbidden) {
    if (source.includes(marker.value)) {
      findings.push(`${marker.label}: ${file}`);
    }
  }
}

if (findings.length > 0) {
  console.error("客户端产物包含仅应存在于服务端的题目资料：");
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`客户端边界检查通过（扫描 ${files.length} 个 JavaScript 文件）`);
}
