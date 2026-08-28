import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

async function load(accountSelfService: boolean | undefined) {
  vi.resetModules();
  vi.doMock("@/lib/site", () => ({ site: { accountSelfService } }));
  return import("@/lib/accounts/self-service");
}

afterEach(() => {
  vi.doUnmock("@/lib/site");
  vi.resetModules();
});

describe("账号自助修改开关", () => {
  it("站点没有声明时按允许处理", async () => {
    const { selfServiceEnabled } = await load(undefined);
    expect(
      selfServiceEnabled,
      "绝大多数部署不会写这个字段，默认必须是原来的行为",
    ).toBe(true);
  });

  it("只有显式写 false 才关闭", async () => {
    expect((await load(false)).selfServiceEnabled).toBe(false);
    expect((await load(true)).selfServiceEnabled).toBe(true);
  });
});

const APP = join(process.cwd(), "app");

/** Calls that rewrite an account's own nickname, username, email or password. */
const WRITES = [
  /\bsetPassword\(/,
  /\bupdateUsername\(/,
  /\bupdateNickname\(/,
  /\bsendPasswordReset\(/,
  /\bsendEmailChangeLink\(/,
  /\.update\(accounts\)/,
];

function actionFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...actionFiles(path));
    else if (entry.name === "actions.ts") found.push(path);
  }
  return found;
}

function writers(): string[] {
  return actionFiles(APP)
    .filter((path) => {
      const source = readFileSync(path, "utf8");
      return WRITES.some((pattern) => pattern.test(source));
    })
    .map((path) => relative(process.cwd(), path));
}

describe("自助入口都受开关约束", () => {
  it("扫得到已知的那几个入口", () => {
    expect(
      writers().sort(),
      "一个都没扫到说明 action 文件改名或搬家了，下面那条检查会变成空转",
    ).toEqual([
      "app/(site)/admin/actions.ts",
      "app/(site)/settings/actions.ts",
      "app/(site)/settings/email/actions.ts",
      "app/forgot-password/actions.ts",
      "app/reset-password/actions.ts",
    ]);
  });

  it("每个入口都读了这个开关", () => {
    const unguarded = writers().filter(
      (path) => !readFileSync(path, "utf8").includes("selfServiceEnabled"),
    );

    expect(
      unguarded,
      "新写的自助入口也要能被部署一起关掉，否则演示站会漏一个口子",
    ).toEqual([]);
  });
});
