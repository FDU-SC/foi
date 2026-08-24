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

const forbidden = [
  { label: "题目后端配置", value: "backend:{id:" },
  { label: "题目配置模块", value: 's.s(["problem",0,{slug:' },
  { label: "测试数据路径", value: "maze-runner/v1" },
  { label: "靶机镜像名", value: "foi/chal-leaky-bucket:latest" },
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
