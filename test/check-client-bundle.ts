import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

const PROTOCOL_MARKERS = [
  { label: "题目后端配置", value: "backend:{id:" },
  { label: "内联判题配置", value: 'backend:{kind:"inline"' },
  { label: "题目配置模块", value: 's.s(["problem",0,{slug:' },
  { label: "报名规则", value: "enrollmentPolicy" },
];

const MARKERS_FILE = join(process.cwd(), "content", "leak-markers.json");

function contentMarkers(): { label: string; value: string }[] | null {
  if (!existsSync(MARKERS_FILE)) return null;

  const parsed: unknown = JSON.parse(readFileSync(MARKERS_FILE, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error("content/leak-markers.json 必须是一个数组");
  }
  for (const marker of parsed) {
    if (
      typeof marker !== "object" ||
      marker === null ||
      typeof (marker as { label?: unknown }).label !== "string" ||
      typeof (marker as { value?: unknown }).value !== "string"
    ) {
      throw new Error(
        "content/leak-markers.json 的每一项都要有字符串 label 与 value",
      );
    }
  }
  return parsed as { label: string; value: string }[];
}

const declared = contentMarkers();
const markers = [...PROTOCOL_MARKERS, ...(declared ?? [])];

const findings: string[] = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const marker of markers) {
    if (source.includes(marker.value)) {
      findings.push(`${marker.label}: ${file}`);
    }
  }
}

if (findings.length > 0) {
  console.error("客户端产物包含仅应存在于服务端的题目资料：");
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exitCode = 1;
} else if (declared === null) {

  console.log(
    `客户端边界检查通过（扫描 ${files.length} 个 JavaScript 文件），` +
      `但本次只检查了 ${PROTOCOL_MARKERS.length} 条协议 marker：` +
      `没有 content/leak-markers.json，内联判题与题目私有配置里的字符串未被覆盖`,
  );
} else {
  console.log(
    `客户端边界检查通过（扫描 ${files.length} 个 JavaScript 文件，` +
      `${PROTOCOL_MARKERS.length} 条协议 marker 加 ${declared.length} 条来自 content）`,
  );
}
