import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTENT_ROOTS } from "../test/content-roots.mjs";
import { entrySpecifiers, keepIn, reachableFiles, strip } from "./strip-content";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoots: string[] = [];

function writeFixture(root: string, path: string, source: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * The stripper decides what survives; these decide the stripper is honest.
 *
 * They assert properties rather than a list of entry points — a list here would
 * be the same hand-written copy the stripper exists to avoid, and would go stale
 * the same way.
 */
describe("抽空保留什么由 lib/ 的 import 决定", () => {
  it("确实扫出了入口，而不是正则写错后空过", () => {
    expect(entrySpecifiers().length).toBeGreaterThanOrEqual(8);
  });

  it("每个入口都落到一个真实文件上", () => {
    const reached = reachableFiles();
    const missing = entrySpecifiers().filter(
      (specifier) =>
        !CONTENT_ROOTS.some((root) =>
          [...reached].some((file) =>
            file.startsWith(join(ROOT, root, specifier.split("/")[0]!)),
          ),
        ),
    );

    expect(
      missing,
      "lib/ 点了一个 content 入口，但两个根里都找不到它——抽空后平台会编译不过",
    ).toEqual([]);
  });

  it("入口经相对 import 摸到的东西也留下", () => {
    const reached = reachableFiles();
    const entries = new Set(
      entrySpecifiers().flatMap((specifier) =>
        CONTENT_ROOTS.map((root) => join(ROOT, root, specifier)),
      ),
    );

    const indirect = [...reached].filter(
      (file) => ![...entries].some((entry) => file.startsWith(entry)),
    );

    expect(
      indirect.length,
      "没有跟出任何间接依赖。_modules/ 是靠相对路径引到 _globs.ts 的，" +
        "跟不出来就说明递归没生效，抽空会把它删掉",
    ).toBeGreaterThan(0);
  });

  it("示例内容会被删掉，不是原样留着", () => {
    for (const root of CONTENT_ROOTS) {
      if (!existsSync(join(ROOT, root))) continue;

      const before = readdirSync(join(ROOT, root));
      const keep = keepIn(root);

      expect(
        before.length,
        `${root}/ 一个条目都没删，抽空检查就什么也没验证`,
      ).toBeGreaterThan(keep.size);
    }
  });

  it("不碰不存在的根", () => {
    const absent = CONTENT_ROOTS.filter((root) => !existsSync(join(ROOT, root)));
    for (const root of absent) {
      expect(keepIn(root).size).toBe(0);
    }
  });

  it("实际抽空时只删除两个 content 根中不可达的顶层条目", () => {
    const root = mkdtempSync(join(tmpdir(), "foi-strip-content-"));
    temporaryRoots.push(root);
    const contentEntry = ["@", "content", "entry"].join("/");

    writeFixture(root, "lib/registry.ts", `export { entry } from "${contentEntry}";`);
    writeFixture(root, "content/entry.ts", 'export { shared } from "./shared";');
    writeFixture(root, "content/shared.ts", "export const shared = true;");
    writeFixture(root, "content/problems/demo.ts", "export const demo = true;");
    writeFixture(root, "content.local/entry.ts", 'export { local } from "./local";');
    writeFixture(root, "content.local/local/index.ts", "export const local = true;");
    writeFixture(root, "content.local/unreachable.ts", "export const unreachable = true;");

    vi.spyOn(console, "log").mockImplementation(() => {});
    strip(root);

    expect(readdirSync(join(root, "content")).sort()).toEqual(["entry.ts", "shared.ts"]);
    expect(readdirSync(join(root, "content.local")).sort()).toEqual(["entry.ts", "local"]);
  });
});
