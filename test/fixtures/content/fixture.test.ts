import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXTURE_CONTENT } from "@/test/fixture-content.mjs";
import { moduleSpecifiers, walk } from "@/test/source";
import { site } from "@/lib/site";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** The specifiers `vitest.config.mts` redirects here. */
const REDIRECTED = new Set(
  FIXTURE_CONTENT.map(({ specifier }) => `@/content/${specifier}`),
);

const AGAINST_FIXTURE = ["app", "components", "lib", "test", "views"];
const AGAINST_NOTHING = ["scripts"];

describe("内核测试跑在夹具上", () => {
  it("lib/ 的每个 content 入口都改道到夹具", () => {
    const entries = new Set(walk(join(ROOT, "lib"))
      .filter((file) => /\.(?:tsx?|mts|m?js)$/.test(file) && !/\.test\.tsx?$/.test(file))
      .flatMap((file) => moduleSpecifiers(readFileSync(file, "utf8")))
      .filter((specifier) => specifier.startsWith("@/content/")));
    expect([...entries].sort(), "入口与夹具改道列表不一致").toEqual([...REDIRECTED].sort());
  });

  it("每个入口的夹具文件都存在", () => {
    const missing = FIXTURE_CONTENT.filter(
      ({ file }) => !existsSync(join(ROOT, "test", "fixtures", "content", file)),
    ).map(({ file }) => file);
    expect(missing, "夹具改道指向不存在的文件").toEqual([]);
  });

  it("站点配置来自夹具，说明入口真的被改道了", () => {
    expect(site.name, "内核测试未使用夹具站点配置").toBe("Fixture");
  });

  it("内核和工具测试不直接导入部署内容", () => {
    const offences: string[] = [];
    for (const dir of [...AGAINST_FIXTURE, ...AGAINST_NOTHING]) {
      const files = walk(join(ROOT, dir)).filter((file) =>
        /\.test\.tsx?$/.test(file) && !relative(ROOT, file).startsWith(join("test", "fixtures")));
      for (const file of files) {
        for (const specifier of moduleSpecifiers(readFileSync(file, "utf8"))) {
          if (!/(^|\/)content(?:\.local)?\//.test(specifier)) continue;
          if (AGAINST_FIXTURE.includes(dir) && REDIRECTED.has(specifier)) continue;
          offences.push(`${relative(ROOT, file)}: ${specifier}`);
        }
      }
    }
    expect(offences, "内核测试通过夹具获取所需形状；工具测试使用自带样例").toEqual([]);
  });
});
