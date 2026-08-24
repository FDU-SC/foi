import { describe, expect, it } from "vitest";
import { assertEnv } from "./env";

const VALID = {
  DATABASE_URL: "postgres://foi:pw@localhost:5432/foi",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  FOI_PUBLIC_URL: "https://foi.example.com",
  FOI_BACKEND_SECRET: "0123456789abcdef0123456789abcdef",
};

function check(overrides: Record<string, string | undefined>) {
  return () => assertEnv({ ...VALID, ...overrides });
}

describe("assertEnv", () => {
  it("配置齐全时通过", () => {
    expect(check({})).not.toThrow();
  });

  it("缺少 DATABASE_URL 时拒绝启动", () => {
    expect(check({ DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it("DATABASE_URL 不是 postgres 连接串时拒绝", () => {
    expect(check({ DATABASE_URL: "mysql://x/y" })).toThrow(/postgres/);
  });

  it("AUTH_SECRET 过短时拒绝，并给出生成命令", () => {
    expect(check({ AUTH_SECRET: "short" })).toThrow(/openssl rand -base64 32/);
  });

  it("FOI_PUBLIC_URL 不是完整 URL 时拒绝", () => {
    expect(check({ FOI_PUBLIC_URL: "foi.example.com" })).toThrow(
      /FOI_PUBLIC_URL/,
    );
  });

  it("缺少 FOI_BACKEND_SECRET 时拒绝", () => {
    expect(check({ FOI_BACKEND_SECRET: undefined })).toThrow(
      /FOI_BACKEND_SECRET/,
    );
  });

  it("只设置了改名前的 FOI_JUDGE_SECRET 也算数", () => {
    expect(
      check({
        FOI_BACKEND_SECRET: undefined,
        FOI_JUDGE_SECRET: VALID.FOI_BACKEND_SECRET,
      }),
    ).not.toThrow();
  });

  it("一次报出全部问题，而不是只报第一个", () => {
    let message = "";
    try {
      assertEnv({ FOI_PUBLIC_URL: VALID.FOI_PUBLIC_URL });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("AUTH_SECRET");
    expect(message).toContain("FOI_BACKEND_SECRET");
  });

  it("不因为可选变量缺失而拒绝启动", () => {
    // SMTP falls back to logging, backend URLs have defaults, the backup
    // interval has a default. None of these should stop a boot.
    expect(check({})).not.toThrow();
  });
});
