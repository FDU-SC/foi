import { readFileSync } from "node:fs";
import { join } from "node:path";
// `unstable_doesMiddlewareMatch`, not the `unstable_doesProxyMatch` the v16
// documentation names: the file convention was renamed to Proxy, the testing
// helper was not, and 16.3.1 ships only the old spelling. Importing the
// documented name from this CommonJS module yields `undefined` rather than an
// error, so it fails at the call site with "not a function" — worth naming
// here so the next person does not go looking for a broken matcher.
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";

/**
 * Which paths the global bound actually covers.
 *
 * The matcher is a negative-lookahead regex, which is the kind of thing that
 * looks right and is wrong at the edges — and wrong is silent in both
 * directions. Too narrow and Server Actions quietly fall out of the global
 * layer; too wide and API routes start having their request bodies buffered by
 * Next before the handler gets a chance to stream them.
 *
 * Evaluated with Next's own matcher implementation rather than a regex written
 * again here, because a test that reproduces the thing it is testing only
 * proves the two copies agree.
 *
 * The pattern is read out of `proxy.ts` rather than imported from it. Importing
 * would pull in NextAuth's module initialisation to obtain one string, and
 * `config` has to stay a literal in that file anyway — Next says matcher values
 * "need to be constants so they can be statically analyzed at build-time", so
 * moving it somewhere importable would stop it working. Reading the source is
 * what keeps this test and the deployed matcher the same text.
 *
 * Which is also why this sits at the repository root, beside the file it reads,
 * rather than in `lib/ratelimit/` where it started life as
 * `proxy-matcher.test.ts`. There is no `proxy-matcher.ts` and there cannot be
 * one — the matcher has to stay inline in `proxy.ts` — so that name invented a
 * module, and the directory claimed the test was about rate limiting when half
 * of what it pins is the API exclusion, which exists to keep Next from
 * buffering request bodies.
 */
function proxyMatcher(): string[] {
  const source = readFileSync(join(import.meta.dirname, "proxy.ts"), "utf8");

  const declaration = source.match(/matcher:\s*\[([\s\S]*?)\]/);
  if (!declaration) throw new Error("proxy.ts 里找不到 matcher 声明");

  const patterns = [...declaration[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(
    (match) => match[1],
  );
  if (patterns.length === 0) throw new Error("proxy.ts 的 matcher 是空的");

  return patterns;
}

const config = { matcher: proxyMatcher() };

function matches(url: string): boolean {
  return unstable_doesMiddlewareMatch({ config, url });
}

describe("proxy matcher 覆盖面", () => {
  it("确实读到了 proxy.ts 里的那个 matcher", () => {
    // Without this, a parse that silently found nothing would make every
    // assertion below meaningless in whichever direction the default falls.
    expect(config.matcher).toHaveLength(1);
    expect(config.matcher[0]).toContain("?!");
  });

  it("页面进全局层", () => {
    expect(matches("/")).toBe(true);
    expect(matches("/problems")).toBe(true);
    expect(matches("/problems/maze-runner")).toBe(true);
    expect(matches("/contests/demo-acm/standings")).toBe(true);
    expect(matches("/admin/accounts")).toBe(true);
  });

  /**
   * Server Actions are POSTs to the page they are used on, so covering these
   * paths is what puts `login`, `registerAction`, `requestPasswordReset` and
   * `resetPasswordAction` behind the bound — none of them named anywhere.
   */
  it("承载 Server Action 的页面都在里面", () => {
    for (const page of [
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password",
      "/admin",
    ]) {
      expect(matches(page), `${page} 应当进全局层`).toBe(true);
    }
  });

  /**
   * The load-bearing exclusion. Proxy covering an API route makes Next buffer
   * a clone of the request body, which is exactly what `readTextBody` exists
   * to avoid — `PUT /api/runner/jobs/[id]` answers to no session and takes the
   * largest body of the three.
   */
  it("API 路由一律不进，否则请求体会被 Next 预先缓冲", () => {
    for (const route of [
      "/api/submissions",
      "/api/submissions/sub_01",
      "/api/submissions/stream",
      "/api/runner/jobs/request",
      "/api/runner/jobs/sub_01",
      "/api/judges/status",
      "/api/health",
      "/api/problems/maze-runner/action/spawn",
      "/api/auth/session",
    ]) {
      expect(matches(route), `${route} 不应当进 proxy`).toBe(false);
    }
  });

  it("静态资源不进，否则一次页面加载就会吃掉一个来源的配额", () => {
    expect(matches("/_next/static/chunks/main.js")).toBe(false);
    expect(matches("/_next/image")).toBe(false);
    expect(matches("/favicon.ico")).toBe(false);
  });
});
