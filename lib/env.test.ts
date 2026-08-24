import { describe, expect, it } from "vitest";
import { backendsMissingUrl } from "@/backends.config";
import { assertEnv } from "./env";

const VALID = {
  DATABASE_URL: "postgres://foi:pw@localhost:5432/foi",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  FOI_PUBLIC_URL: "https://foi.example.com",
  FOI_BACKEND_SECRET: "0123456789abcdef0123456789abcdef",
};

/**
 * Every backend address variable, asked for rather than written out here.
 *
 * An empty environment is missing all of them, so this names the full set —
 * and a backend added to `backends.config.ts` reaches these cases without
 * anybody remembering to come back, which is the same reason the function
 * itself collects the names as the entries are built rather than from a list.
 */
const URL_VARIABLES = backendsMissingUrl({});

const SOME_ADDRESS = "http://judge.internal:4100";

/** The pre-rename spelling `backendUrl` still accepts. */
function legacy(variable: string): string {
  return variable.replace("FOI_BACKEND_", "FOI_JUDGE_");
}

function addresses(
  spell: (variable: string) => string = (variable) => variable,
): Record<string, string> {
  return Object.fromEntries(
    URL_VARIABLES.map((variable) => [spell(variable), SOME_ADDRESS]),
  );
}

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
    // SMTP falls back to logging and the backup interval has a default;
    // neither should stop a boot. Backend addresses used to be on that list
    // and are not any more — see the block below for what replaced it.
    expect(check({})).not.toThrow();
  });
});

/**
 * The one check that is fatal in one environment and not in another.
 *
 * Outside production a missing address falls back to the mock, which is what
 * lets a fresh checkout submit before anything is configured; in production
 * that fallback was the deployment quietly dispatching to whatever sat on
 * :4100 beside it. Both halves are pinned here, because dropping either one
 * turns this back into a default nobody notices — the version that refuses
 * everywhere breaks `pnpm dev`, and the version that refuses nowhere is what
 * this replaced.
 */
describe("生产环境的题目后端地址", () => {
  it("缺地址时拒绝启动，并点名该设哪个变量", () => {
    expect(check({ NODE_ENV: "production" })).toThrow(URL_VARIABLES[0]);
  });

  it("每一个缺的都报出来，而不是只报第一个", () => {
    let message = "";
    try {
      assertEnv({ ...VALID, NODE_ENV: "production" });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    for (const variable of URL_VARIABLES) {
      expect(message).toContain(variable);
    }
  });

  it("配齐了就通过", () => {
    expect(check({ NODE_ENV: "production", ...addresses() })).not.toThrow();
  });

  /**
   * The rename was deliberately not synchronised with a deploy, so a running
   * environment may still hold only the old spelling. Refusing to boot on a
   * deployment that is configured correctly under the old names would be this
   * check causing the outage it exists to prevent.
   */
  it("只设置了改名前的 FOI_JUDGE_<名字>_URL 也算数", () => {
    expect(
      check({ NODE_ENV: "production", ...addresses(legacy) }),
    ).not.toThrow();
  });

  it("填成空串等于没填", () => {
    const blank = Object.fromEntries(
      URL_VARIABLES.map((variable) => [variable, ""]),
    );

    expect(check({ NODE_ENV: "production", ...blank })).toThrow(
      URL_VARIABLES[0],
    );
  });

  it("非生产环境缺地址不拒绝启动——开发靠 mock 回落", () => {
    for (const NODE_ENV of ["development", "test", undefined]) {
      expect(check({ NODE_ENV })).not.toThrow();
    }
  });
});
