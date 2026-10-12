import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it, vi } from "vitest";
import { config } from "./proxy";

vi.mock("next-auth", () => ({
  default: () => ({ auth: (handler: unknown) => handler }),
}));

function matches(url: string): boolean {
  return unstable_doesMiddlewareMatch({ config, url });
}

describe("proxy matcher 覆盖面", () => {
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
