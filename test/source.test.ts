import { describe, expect, it } from "vitest";
import { exportedNames, importBindings, moduleSpecifiers, parseSource } from "./source";

describe("源码扫描", () => {
  it("识别静态、动态、重导出及副作用依赖，忽略注释和字符串", () => {
    expect(moduleSpecifiers(`
      import { x } from 'one';
      import 'two';
      export { y } from 'three';
      const lazy = import('four');
      // import 'comment';
      const text = "import 'text'";
    `)).toEqual(["one", "two", "three", "four"]);
  });

  it("导出函数、变量、别名和解构均按对外名称收集", () => {
    expect(exportedNames(parseSource(`
      export async function GET() {}
      export const POST = handler;
      export { handler as PUT };
      export const { DELETE, nested: { PATCH } } = handlers;
      export type { HEAD };
      // export function OPTIONS() {}
      const text = 'export const HEAD = handler';
    `))).toEqual(["GET", "POST", "PUT", "DELETE", "PATCH"]);
  });

  it("保留导入别名与命名空间，忽略类型导入", () => {
    expect(importBindings(parseSource(`
      import Default, { original as renamed, type Props } from 'one';
      import * as namespace from 'two';
      import type { Other } from 'three';
    `))).toEqual([
      { local: "Default", imported: "default", source: "one" },
      { local: "renamed", imported: "original", source: "one" },
      { local: "namespace", imported: "*", source: "two" },
    ]);
  });
});
