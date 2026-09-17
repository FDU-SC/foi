import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  getRedirectUrl,
  unstable_doesMiddlewareMatch,
} from "next/experimental/testing/server";
import {
  type NextFetchEvent,
  NextRequest,
  type NextResponse,
} from "next/server";
import { describe, expect, it, vi } from "vitest";

const catalogueRedirect = vi.hoisted(() => vi.fn());

vi.mock("next-auth", () => ({
  default: () => ({ auth: (handler: unknown) => handler }),
}));

vi.mock("@/lib/contests/catalogue", () => ({ catalogueRedirect }));

const { default: wrappedProxy } = await import("./proxy");
const proxy = wrappedProxy as unknown as (
  request: NextRequest,
  event: NextFetchEvent,
) => NextResponse | Promise<NextResponse>;

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

    expect(config.matcher).toHaveLength(1);
    expect(config.matcher[0]).toContain("?!");
  });

  it("页面进全局层", () => {
    expect(matches("/")).toBe(true);
    expect(matches("/contests")).toBe(true);
    expect(matches("/contests/some-contest/problems/some-problem")).toBe(true);
    expect(matches("/contests/some-contest/standings")).toBe(true);
    expect(matches("/problems")).toBe(true);
    expect(matches("/problems/some-section")).toBe(true);
    expect(matches("/problems/some-section/some-problem")).toBe(true);
    expect(matches("/problems/some-section/standings")).toBe(true);
    expect(matches("/admin/accounts")).toBe(true);
  });

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

  it("API 路由一律不进，否则请求体会被 Next 预先缓冲", () => {
    for (const route of [
      "/api/submissions",
      "/api/submissions/sub_01",
      "/api/submissions/stream",
      "/api/runner/jobs/request",
      "/api/runner/jobs/sub_01",
      "/api/judges/status",
      "/api/health",
      "/api/contests/a-contest/problems/a-problem/action/some-action",
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

describe("题库旧地址跳转", () => {
  it("目标参数优先，并保留来源地址的其他参数", async () => {
    catalogueRedirect.mockReturnValueOnce("/leaderboard?board=direction");

    const response = await proxy(
      new NextRequest(
        "https://example.test/contests/section/standings?board=stale&filter=solved&filter=attempted",
      ),
      {} as NextFetchEvent,
    );
    const destination = new URL(getRedirectUrl(response)!);

    expect(catalogueRedirect).toHaveBeenCalledWith(
      "/contests/section/standings",
    );
    expect(response.status).toBe(307);
    expect(destination.pathname).toBe("/leaderboard");
    expect(destination.searchParams.getAll("board")).toEqual(["direction"]);
    expect(destination.searchParams.getAll("filter")).toEqual([
      "solved",
      "attempted",
    ]);
  });
});
