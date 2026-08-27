import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTION_LIMITS,
  ROUTE_LIMITS,
  SOURCE_GATE,
  type RateLimitRule,
} from "./policy";

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
      if (rule.kind !== "unlimited") continue;
      expect(rule.why.length, `${key} 的 unlimited 没有写理由`).toBeGreaterThan(
        0,
      );
    }
  });

  it("每条 fixed 的数值都是正的", () => {
    for (const [key, rule] of ALL_RULES) {
      if (rule.kind !== "fixed") continue;
      expect(rule.max, `${key} 的 max`).toBeGreaterThan(0);
      expect(rule.windowSeconds, `${key} 的 windowSeconds`).toBeGreaterThan(0);
    }
  });

  it("第二重限流计的是另一个 subject，并说清它单独挡住什么", () => {
    const wrong: string[] = [];

    for (const [key, rule] of ALL_RULES) {
      if (rule.kind === "unlimited" || rule.also === undefined) continue;
      const also = rule.also;

      if (also.subject === rule.subject) {
        wrong.push(`${key}：两重限流都按 ${rule.subject} 计数`);
      }
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

  it("来源闸的数值仍然是个闸", () => {
    expect(SOURCE_GATE.max).toBeGreaterThan(0);
    expect(SOURCE_GATE.max).toBeLessThanOrEqual(1_000);
  });
});

describe("guard: framework 背后确实有东西", () => {
  const ROOT = join(import.meta.dirname, "..", "..");
  const require = createRequire(join(ROOT, "/"));

  const core = createRequire(require.resolve("next-auth")).resolve(
    "@auth/core",
  );
  const source = readFileSync(join(dirname(core), "lib", "index.js"), "utf8");

  const POST_BRANCH = "const { csrfTokenVerified } = options;";

  function postCases(): Map<string, string> {
    const start = source.indexOf(POST_BRANCH);
    if (start === -1) return new Map();

    const branch = source.slice(start);
    const bounded = branch.slice(0, branch.indexOf("throw new UnknownAction"));

    return new Map(
      bounded
        .split('case "')
        .slice(1)
        .map((segment) => {
          const close = segment.indexOf('"');
          return [segment.slice(0, close), segment.slice(close)] as const;
        }),
    );
  }

  it("扫描确实找到了 POST 分支，而不是结构变了以后空过", () => {
    const cases = postCases();

    expect(
      cases.size,
      `在 ${core} 里找不到 "${POST_BRANCH}" 之后的 switch，` +
        "说明 @auth/core 的结构变了——先确认 CSRF 检查还在，再改这个扫描",
    ).toBeGreaterThanOrEqual(4);
  });

  it.each(["callback", "session", "signin", "signout"])(
    "POST %s 仍然验 CSRF",
    (action) => {
      const body = postCases().get(action);

      expect(body, `@auth/core 的 POST 分支里没有 case "${action}"`).toBeDefined();
      expect(
        body,
        `case "${action}" 不再调用 validateCSRF —— ROUTE_LIMITS 里那条 ` +
          "`guard: \"framework\"` 现在是一句假话，改成 same-origin 之前先读" +
          "路由文件顶部关于表单 content-type 的那段",
      ).toContain("validateCSRF");
    },
  );

  it("本部署只注册了 credentials provider，所以那个条件不排除任何东西", () => {
    const auth = readFileSync(join(ROOT, "auth.ts"), "utf8");
    const providers = [
      ...auth.matchAll(/from "next-auth\/providers\/([\w-]+)"/g),
    ].map((match) => match[1]);

    expect(
      providers,
      "多了一个 provider。OAuth 的 POST callback 不走 validateCSRF（它靠 state 与 " +
        "PKCE），而 ROUTE_LIMITS 里的 guard 是按整条路由声明的——" +
        "先决定那条声明还成不成立",
    ).toEqual(["credentials"]);
  });
});
