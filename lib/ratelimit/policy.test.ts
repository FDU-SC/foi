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

/**
 * What stops the table becoming a snapshot of one afternoon.
 *
 * A list of every entry point is only worth having if it is still complete
 * next month, and nothing about writing a new route handler reminds anybody
 * that a list exists. So the list is checked against the filesystem: add a
 * route or a Server Action without deciding what bounds it, and this fails
 * with the name of the thing you added.
 *
 * Deliberately a source-text scan rather than importing the modules. Importing
 * a route handler drags in the database, the content registries and Auth.js,
 * which is a lot of machinery to stand up in order to ask which functions a
 * file exports — and a test that is expensive to run is a test that gets
 * skipped.
 */

const ROOT = join(import.meta.dirname, "..", "..");

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() ? [path] : [];
  });
}

/** `app/api/submissions/[id]/route.ts` becomes `/api/submissions/[id]`. */
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

/**
 * Whether a file exports a handler for `method`, in any spelling Next takes.
 *
 * This used to know only `export function GET`, and the one it did not know is
 * the one this repository actually uses for the route it most needed to hear
 * about: `app/api/auth/[...nextauth]/route.ts` hands the pair straight back
 * out of Auth.js as `export const { GET, POST } = handlers`. So the
 * completeness check below passed while the table was two entries short — a
 * list of every way in that had quietly stopped being one, which is the exact
 * failure it exists to prevent, arrived at through the test rather than around
 * it.
 *
 * Deliberately loose. A false positive names a route that then has to be
 * decided about, and whoever reads the failure either fills the entry in or
 * corrects this function; a false negative says nothing at all. Only one of
 * those gets found.
 */
function exportsHandler(source: string, method: string): boolean {
  return [
    // export function GET / export async function GET
    `export\\s+(?:async\\s+)?function\\s+${method}\\b`,
    // export const GET = … / export const GET: … = …
    `export\\s+(?:const|let|var)\\s+${method}\\b`,
    // export const { GET, POST } = handlers / export { GET, POST }
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

/**
 * Both tables under one key space, widened from their literal types so that
 * the optional second bound is readable on every entry rather than only on the
 * two that carry one.
 */
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

  /**
   * The other direction. A stale entry is not a hole, but it is a lie about
   * what this application has in it, and the whole value of the table is that
   * it can be read as the truth.
   */
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
    // Without this, a wrong ROOT would make every assertion above pass by
    // finding nothing at all — the failure mode of a filesystem test.
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

  /**
   * What makes a second bound worth writing down rather than folding into the
   * first: it counts something the first cannot see. Two bounds on the same
   * subject are one bound and an argument about which number wins, and the
   * looser of them would then be dead text that reads like a control — see
   * `AlsoBound`, where the two live cases are argued.
   */
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

  /**
   * That every route names a `guard` is a compile error to omit, so it needs no
   * test. What the type cannot say is that the answer is sane for the method:
   * `read-only` on a POST is one careless copy-paste, and it silently removes
   * the cross-origin check from a route that writes.
   *
   * A state-changing route may still be exempt — `PUT /api/runner/jobs/[id]`
   * is — but it has to claim `signed`, which is a different sentence and one
   * nobody writes by accident.
   */
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

  /**
   * The gate is the only bound the runner routes have, so it being loose enough
   * to be useless would be a quiet regression.
   */
  it("来源闸的数值仍然是个闸", () => {
    expect(SOURCE_GATE.max).toBeGreaterThan(0);
    expect(SOURCE_GATE.max).toBeLessThanOrEqual(1_000);
  });
});

/**
 * The one guard whose evidence is not in this repository.
 *
 * `same-origin` and `signed` are claims about code above — `originGate` runs
 * for the first, and `verifySignature` for the second, and both are a few
 * lines away. `framework` is a claim about `@auth/core`: that it runs its own
 * double-submit CSRF check, so `guardRequest` adding ours would be a second
 * answer to a question already answered.
 *
 * It was true when it was written and it is true now. What was missing is
 * anything that would notice it stopping being true, and two ordinary changes
 * would do that with every test still green:
 *
 * - **Adding an OAuth provider.** The `callback` case guards its
 *   `validateCSRF` on `provider.type === "credentials"`, which is correct of
 *   Auth.js — OAuth carries `state` and PKCE instead. But the guard in
 *   `ROUTE_LIMITS` is declared per route, so it would go on claiming coverage
 *   for a provider that is deliberately outside it.
 * - **Upgrading `@auth/core`.** Those four `validateCSRF` calls are four lines
 *   in one switch. A refactor that moves them is not a breaking change to
 *   anybody reading the changelog.
 *
 * So this scans the dependency, the same way `enforcement.test.ts` scans this
 * repository and for the same reason: a table nothing checks is a table that
 * describes the afternoon it was written. Resolved rather than hardcoded,
 * because pnpm puts the version in the path and a version bump should fail
 * with "the guarantee moved", not with "no such file".
 */
describe("guard: framework 背后确实有东西", () => {
  const ROOT = join(import.meta.dirname, "..", "..");
  const require = createRequire(join(ROOT, "/"));

  /**
   * Reached through `next-auth` rather than directly: `@auth/core` is its
   * dependency, not ours, and pnpm's layout means this repository cannot
   * resolve it on its own. Going the long way is also the honest description
   * of where the guarantee comes from.
   */
  const core = createRequire(require.resolve("next-auth")).resolve(
    "@auth/core",
  );
  const source = readFileSync(join(dirname(core), "lib", "index.js"), "utf8");

  /**
   * The POST half only. The GET half runs no CSRF check and should not — a
   * cross-site read can be caused but not seen, which is the same argument
   * `read-only` makes in the table above.
   */
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

  /**
   * `callback` is the sign-in itself and the only one of the four this
   * deployment's UI never reaches, since `signIn` in a Server Action runs
   * `Auth()` in-process. It is still the one that matters most: posting
   * straight to `/callback/credentials` is a real way in, which is why
   * `login`'s bound lives in `authorize` rather than in the Server Action.
   */
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

  /**
   * The other half, and the half that changes in this repository rather than
   * in `node_modules`. `callback`'s `validateCSRF` is conditional on the
   * provider being credentials, so the assertion above only covers what this
   * deployment serves for as long as that is all it serves.
   */
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
