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

  it("FOI_ENV 拼错时拒绝启动，并列出合法取值", () => {
    expect(check({ FOI_ENV: "prodution" })).toThrow(/FOI_ENV/);
    expect(check({ FOI_ENV: "prodution" })).toThrow(/prod/);
  });

  it("FOI_ENV 的两个合法取值都通过，不设也通过", () => {
    for (const declared of ["dev", "prod", undefined, ""]) {
      expect(check({ FOI_ENV: declared })).not.toThrow();
    }
  });

  it("不接受 staging，预发布环境按 prod 对待", () => {
    expect(check({ FOI_ENV: "staging" })).toThrow(/FOI_ENV/);
  });

  it("FOI_RELEASE_SHA 不是 sha 时拒绝启动，缺失则通过", () => {
    expect(check({ FOI_RELEASE_SHA: "${{ github.sha }}" })).toThrow(
      /FOI_RELEASE_SHA/,
    );
    expect(check({ FOI_RELEASE_SHA: "not-a-sha" })).toThrow(/FOI_RELEASE_SHA/);

    for (const value of [undefined, "", "0123abc", "a".repeat(40)]) {
      expect(check({ FOI_RELEASE_SHA: value })).not.toThrow();
    }
  });

  it("不因为可选变量缺失而拒绝启动", () => {

    expect(check({})).not.toThrow();
  });
});

