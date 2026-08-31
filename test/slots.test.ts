import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SLOTS } from "@/test/content-roots.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * What makes a fork's merges conflict-free.
 *
 * Every slot is the same mechanism: an alias resolving to the deployment's root
 * first and the upstream's second, per file. These guards keep the three halves
 * of that in agreement — the alias table, the layer that may be overridden, and
 * the layer that may not reach past its entry points.
 */

function walk(directory: string): string[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() ? [path] : [];
  });
}

function key(file: string): string {
  return relative(ROOT, file).split(sep).join("/");
}

interface TsConfig {
  compilerOptions: { paths: Record<string, string[]> };
}

function tsconfigPaths(): Record<string, string[]> {
  const source = readFileSync(join(ROOT, "tsconfig.json"), "utf8");
  return (JSON.parse(source) as TsConfig).compilerOptions.paths;
}

describe("插槽的别名表", () => {
  it("每个插槽都先解析到部署那一半，再回落到上游", () => {
    const paths = tsconfigPaths();

    for (const slot of SLOTS) {
      const pattern = `${slot.alias}/*`;
      expect(
        paths[pattern],
        `${pattern} 没有在 tsconfig.json 里映射，这个插槽是空的`,
      ).toEqual([`./${slot.local}/*`, `./${slot.upstream}/*`]);
    }
  });

  it("兜底的 @/* 排在插槽后面，否则更具体的映射不会生效", () => {
    const patterns = Object.keys(tsconfigPaths());
    const fallback = patterns.indexOf("@/*");

    expect(fallback, "@/* 不在 paths 里").toBeGreaterThanOrEqual(0);
    for (const slot of SLOTS) {
      expect(
        patterns.indexOf(`${slot.alias}/*`),
        `${slot.alias}/* 排在 @/* 之后`,
      ).toBeLessThan(fallback);
    }
  });

  it("每个插槽的上游那一半都在", () => {
    const missing = SLOTS.map((slot) => slot.upstream).filter(
      (root) => !existsSync(join(ROOT, root)),
    );

    expect(
      missing,
      "回落的那一头没了，插槽里没放同名文件的模块就解析不到任何东西",
    ).toEqual([]);
  });
});

/** Next discovers routes from the filesystem, so these files cannot be aliased. */
const ROUTE_FILES = /\/(page|layout|error|not-found|loading|template)\.tsx$/;

/**
 * A shell forwards and declares; it does not render. The number is loose on
 * purpose — it only has to catch a page body growing back here, where a fork
 * could not override it.
 */
const SHELL_MAX_LINES = 25;

describe("app/ 只有薄壳", () => {
  const shells = walk(join(ROOT, "app")).filter((file) =>
    ROUTE_FILES.test(file.split(sep).join("/")),
  );

  it("确实找到了路由文件，而不是路径写错后空过", () => {
    expect(shells.length).toBeGreaterThanOrEqual(20);
  });

  it("每个路由文件都短到只剩转发与段配置", () => {
    const bloated = shells
      .map((file) => ({ file, lines: readFileSync(file, "utf8").split("\n").length }))
      .filter(({ lines }) => lines > SHELL_MAX_LINES)
      .map(({ file, lines }) => `${key(file)}（${lines} 行）`);

    expect(
      bloated,
      `app/ 下的路由文件是 Next 的契约，下游覆盖不了它们。` +
        `页面主体属于 views/，这里只留段配置和一层转发`,
    ).toEqual([]);
  });

  it("每个渲染页面的主体都来自 views/", () => {
    const detached = shells
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        // A route that only redirects renders nothing, so it has no view.
        if (!/return\s*\(?\s*</.test(source)) return false;
        return !/from\s+["']@\/views\//.test(source);
      })
      .map(key);

    expect(
      detached,
      "这些路由自己渲染了内容。搬进 views/，下游才能整页替换",
    ).toEqual([]);
  });
});

/** Only `lib/` reaches content, and only through the entry points. */
const UI_LAYERS = ["app", "components", "views"];

const CONTENT_IMPORT = /from\s+["'](@\/content\/[^"']*)["']/g;

describe("UI 层不认识 content", () => {
  it("app/、components/、views/ 都不直接 import content", () => {
    const offences: string[] = [];

    for (const layer of UI_LAYERS) {
      for (const file of walk(join(ROOT, layer))) {
        if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;

        const source = readFileSync(file, "utf8");
        for (const [, specifier] of source.matchAll(CONTENT_IMPORT)) {
          offences.push(`${key(file)}: ${specifier}`);
        }
      }
    }

    expect(
      offences,
      "内容只经由 lib/ 的入口进入平台。UI 层直接伸进 content/，" +
        "就等于把某个部署的形状焊进了平台",
    ).toEqual([]);
  });
});
