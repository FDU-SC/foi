import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { exportedNames, parseSource, walk } from "@/test/source";
import {
  ACTION_LIMITS,
  ROUTE_LIMITS,
  type RateLimitRule,
  type RouteRule,
} from "./policy";

const ROOT = join(import.meta.dirname, "..", "..");

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

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

function declaredHandlers(): Handler[] {
  return walk(join(ROOT, "app", "api"))
    .filter((file) => file.endsWith("route.ts"))
    .flatMap((file) => {
      const names = exportedNames(parseSource(readFileSync(file, "utf8")));
      return names.filter((name) => HTTP_METHODS.includes(name))
        .map((method) => ({ key: `${method} ${routePath(file)}`, file }));
    });
}

const ALL_RULES: [string, RateLimitRule][] = [
  ...Object.entries(ROUTE_LIMITS),
  ...Object.entries(ACTION_LIMITS),
];

const ROUTE_RULES: [string, RouteRule][] = Object.entries(ROUTE_LIMITS);

function declaredActions(): Handler[] {
  return walk(join(ROOT, "app"))
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .flatMap((file) => {
      const source = parseSource(readFileSync(file, "utf8"));
      const server = source.statements.some((statement) =>
        ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) &&
        statement.expression.text === "use server");
      return server ? exportedNames(source).map((key) => ({ key, file })) : [];
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

    expect(declaredHandlers().length).toBeGreaterThan(0);
    expect(declaredActions().length).toBeGreaterThan(0);
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

  it("改掉来源闸门的路由说清默认值为什么不合适", () => {
    const wrong: string[] = [];

    for (const [key, rule] of ROUTE_RULES) {
      if (rule.flood === undefined) continue;
      const flood = rule.flood;

      if (flood.why.length === 0) {
        wrong.push(`${key}：放宽了来源闸门却没有写默认值为什么不合适`);
      }
      if (flood.max <= 0 || flood.windowSeconds <= 0) {
        wrong.push(`${key}：来源闸门的数值不是正的`);
      }
    }

    expect(wrong, "来源闸门的覆盖声明有问题").toEqual([]);
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
