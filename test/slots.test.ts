import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import { SLOTS } from "@/test/content-roots.mjs";
import { importBindings, moduleSpecifiers, nodes, parseSource, walk } from "@/test/source";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Check that slot aliases resolve local-first with per-file fallback, only
 * allowed layers are overridable, and platform imports use content entry points.
 */

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

function localRendering(source: string): string[] {
  const file = parseSource(source);
  const views = importBindings(file).filter(({ source }) => source.startsWith("@/views/"));
  return nodes(file, (node): node is ts.JsxOpeningElement | ts.JsxSelfClosingElement =>
    ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
    .filter(({ tagName }) => !views.some(({ local, imported }) =>
      ts.isIdentifier(tagName) ? imported !== "*" && tagName.text === local :
        ts.isPropertyAccessExpression(tagName) && ts.isIdentifier(tagName.expression) &&
        imported === "*" && tagName.expression.text === local))
    .map(({ tagName }) => tagName.getText(file));
}

describe("app/ 只有薄壳", () => {
  const shells = walk(join(ROOT, "app")).filter((file) =>
    ROUTE_FILES.test(file.split(sep).join("/")),
  );

  it("确实找到了路由文件，而不是路径写错后空过", () => {
    expect(shells.length).toBeGreaterThan(0);
  });

  it("每个渲染页面的主体都来自 views/", () => {
    const detached = shells
      .filter((file) => localRendering(readFileSync(file, "utf8")).length > 0)
      .map(key);

    expect(
      detached,
      "这些路由自己渲染了内容。搬进 views/，下游才能整页替换",
    ).toEqual([]);
  });

  it("接受转发及重命名导入，检测独立页面内容而非仅检查 import", () => {
    expect(localRendering(`import { View as Page } from '@/views/page'; export default () => <Page />;`)).toEqual([]);
    expect(localRendering(`import * as Views from '@/views/page'; export default () => <Views.Page />;`)).toEqual([]);
    expect(localRendering(`export { View as default } from '@/views/page';`)).toEqual([]);
    expect(localRendering(`import { View } from '@/views/page'; export default () => <main><View /></main>;`)).toEqual(["main"]);
  });
});

/** Only `lib/` reaches content, and only through the entry points. */
const UI_LAYERS = ["app", ...SLOTS.filter(({ alias }) => alias !== "@/content")
  .flatMap(({ upstream, local }) => [upstream, local])];

describe("UI 层不认识 content", () => {
  it("app/、components/、views/ 都不直接 import content", () => {
    const offences: string[] = [];

    for (const layer of UI_LAYERS) {
      for (const file of walk(join(ROOT, layer))) {
        if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;

        const source = readFileSync(file, "utf8");
        for (const specifier of moduleSpecifiers(source)) {
          if (!/(^|\/)content(?:\.local)?\//.test(specifier)) continue;
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
