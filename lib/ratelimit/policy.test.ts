import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_LIMITS, ROUTE_LIMITS, type RateLimitRule } from "./policy";

const ROOT = join(import.meta.dirname, "..", "..");

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() ? [path] : [];
  });
}

function routePath(file: string): string {
  return file
    .slice(join(ROOT, "app").length)
    .replace(/\/route\.ts$/, "")
    .replace(/\\/g, "/");
}

interface Handler {
  key: string;
  file: string;
}

function exportsHandler(source: string, method: string): boolean {
  return [

    `export\\s+(?:async\\s+)?function\\s+${method}\\b`,

    `export\\s+(?:const|let|var)\\s+${method}\\b`,

    `export\\s+(?:const|let|var)?\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`,
  ].some((pattern) => new RegExp(pattern).test(source));
}

function declaredHandlers(): Handler[] {
  return walk(join(ROOT, "app", "api"))
    .filter((file) => file.endsWith("route.ts"))
    .flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return HTTP_METHODS.filter((method) =>
        exportsHandler(source, method),
      ).map((method) => ({ key: `${method} ${routePath(file)}`, file }));
    });
}

const ALL_RULES: [string, RateLimitRule][] = [
  ...Object.entries(ROUTE_LIMITS),
  ...Object.entries(ACTION_LIMITS),
];

function declaredActions(): Handler[] {
  return walk(join(ROOT, "app"))
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .flatMap((file) => {
      const source = readFileSync(file, "utf8");
      if (!/^\s*["']use server["']/m.test(source)) return [];

      return [...source.matchAll(/export\s+async\s+function\s+(\w+)/g)].map(
        (match) => ({ key: match[1], file }),
      );
    });
}

describe("限流入口表", () => {
  it("每个 route handler 都在表里表过态", () => {
    const missing = declaredHandlers()
      .filter((handler) => !(handler.key in ROUTE_LIMITS))
      .map((handler) => `${handler.key}  (${handler.file})`);

    expect(missing, "新增了路由但没有在 ROUTE_LIMITS 里说明它的限流").toEqual(
      [],
    );
  });

  it("每个 Server Action 都在表里表过态", () => {
    const missing = declaredActions()
      .filter((action) => !(action.key in ACTION_LIMITS))
      .map((action) => `${action.key}  (${action.file})`);

    expect(missing, "新增了 Server Action 但没有在 ACTION_LIMITS 里说明它的限流").toEqual(
      [],
    );
  });

  it("表里没有已经不存在的入口", () => {
    const live = new Set(declaredHandlers().map((handler) => handler.key));
    const stale = Object.keys(ROUTE_LIMITS).filter((key) => !live.has(key));

    expect(stale, "ROUTE_LIMITS 里的条目在 app/api 下已经找不到").toEqual([]);
  });

  it("Server Action 表里也没有多余条目", () => {
    const live = new Set(declaredActions().map((action) => action.key));
    const stale = Object.keys(ACTION_LIMITS).filter((key) => !live.has(key));

    expect(stale, "ACTION_LIMITS 里的条目已经找不到对应的导出").toEqual([]);
  });

  it("扫描确实找到了东西，而不是路径写错后空过", () => {

    expect(declaredHandlers().length).toBeGreaterThanOrEqual(8);
    expect(declaredActions().length).toBeGreaterThanOrEqual(10);
  });

  it("每条 unlimited 都写了理由", () => {
    for (const [key, rule] of ALL_RULES) {
      if (!("unlimited" in rule)) continue;
      expect(rule.why.length, `${key} 的 unlimited 没有写理由`).toBeGreaterThan(
        0,
      );
    }
  });

  it("每条 fixed 的数值都是正的", () => {
    for (const [key, rule] of ALL_RULES) {
      if (!("max" in rule)) continue;
      expect(rule.max, `${key} 的 max`).toBeGreaterThan(0);
      expect(rule.windowSeconds, `${key} 的 windowSeconds`).toBeGreaterThan(0);
    }
  });

  it("第二重限流说清它单独挡住什么", () => {
    const wrong: string[] = [];

    for (const [key, rule] of ALL_RULES) {
      if (!("also" in rule) || rule.also === undefined) continue;
      const also = rule.also;

      if (also.why.length === 0) {
        wrong.push(`${key}：第二重限流没有写它单独挡住什么`);
      }
      if (also.max <= 0 || also.windowSeconds <= 0) {
        wrong.push(`${key}：第二重限流的数值不是正的`);
      }
    }

    expect(wrong, "第二重限流的声明有问题").toEqual([]);
  });

  it("会改状态的方法不能声明成 read-only", () => {
    const mislabelled = Object.entries(ROUTE_LIMITS)
      .filter(([key]) => !key.startsWith("GET ") && !key.startsWith("HEAD "))
      .filter(([, rule]) => rule.guard === "read-only")
      .map(([key]) => key);

    expect(
      mislabelled,
      "这些路由会改状态，guard 必须是 same-origin 或 signed",
    ).toEqual([]);
  });

});

