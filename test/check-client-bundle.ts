/**
 * The belt. The braces are `import "server-only"` in the
 * `content/*-modules.ts` globs.
 *
 * That marker is what actually holds the boundary: reaching a content glob
 * from a client component fails the build, at the import, naming the file.
 * This check cannot do that — it reads minified output after the fact, and
 * every protocol marker below is a guess about what Turbopack emits.
 * `s.s(["problem"` is its codegen shape and will stop matching at some
 * upgrade, silently and with a green build.
 *
 * So it is worth running and not worth trusting. It catches a leak that
 * arrives by a route the marker does not cover — a `NEXT_PUBLIC_` variable, a
 * value inlined into a Server Component's flight payload, a future glob added
 * without the marker — and a green result means only that these strings were
 * absent.
 */
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

/**
 * Shapes the kernel itself produces, so they hold for any `content/`.
 *
 * A match means the module was bundled rather than the public projection
 * `toPublicConfig` produces: these keys exist only inside a problem's
 * `backend.config` or an enrolment rule, both of which are stripped or
 * server-only by construction.
 */
const PROTOCOL_MARKERS = [
  { label: "题目后端配置", value: "backend:{id:" },
  { label: "内联判题配置", value: 'backend:{kind:"inline"' },
  { label: "题目配置模块", value: 's.s(["problem",0,{slug:' },
  { label: "报名规则", value: "reservedHandles" },
];

/**
 * Strings only this deployment's content knows, declared by that content.
 *
 * These used to be listed here: a testdata path, a container image name, two
 * sentences from inline judges. Every one of them was a fact about the
 * problems this repository happens to ship, which made the check quietly
 * useless for any other `content/` — swap the directory and the list stops
 * matching anything, the build stays green, and nothing says the coverage
 * went away.
 *
 * So content declares its own, and their absence is reported rather than
 * assumed harmless. Inline judging is why this half exists at all: a problem
 * judged in the kernel keeps its answers in `backend.config` exactly as a
 * dispatched one does, but it also ships the comparison itself, and no
 * protocol-shaped marker can see that. A placeholder or a tag would be the
 * wrong thing to list — those are public by design.
 */
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
  // Not a failure — a deployment may genuinely have nothing to add — but the
  // difference between "checked everything" and "checked the four shapes the
  // kernel knows" has to be visible, or the green tick claims more than it did.
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
