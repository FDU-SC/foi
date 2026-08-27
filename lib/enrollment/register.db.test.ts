import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountByUsername } from "@/lib/accounts/queries";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { issueToken } from "@/lib/tokens/stateless";
import { register } from "./register";

const EMAIL = "regtest@example.test";
const USERNAME = "regtest";
const TAKEN_USERNAME = "regtest-taken";

const passwordHook = vi.hoisted(() => ({ failSetPassword: false }));

vi.mock("@/lib/accounts/password", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/accounts/password")>();
  return {
    ...actual,
    setPassword: async (...args: Parameters<typeof actual.setPassword>) => {
      if (passwordHook.failSetPassword) throw new Error("写密码故意失败");
      return actual.setPassword(...args);
    },
  };
});

async function reachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

const online = await reachable();
const describeDb = online ? describe : describe.skip;

if (!online) {
  console.warn("[test] 数据库不可达，跳过注册集成用例");
}

function mintToken(email: string): string {
  return issueToken({ purpose: "email-verify", subject: email, ttlMs: 30 * 60 * 1000 });
}

async function cleanup(): Promise<void> {
  await db.delete(accounts).where(inArray(accounts.username, [USERNAME, TAKEN_USERNAME]));
}

const FORM = {
  username: USERNAME,
  nickname: "注册测试",
  email: EMAIL,
  password: "correct-horse-battery",
  token: "",
};

describeDb("register", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "register-suite-signing-key-32b");
    passwordHook.failSetPassword = false;
    return cleanup();
  });
  afterAll(async () => {
    await cleanup();
    vi.unstubAllEnvs();
  });

  it("没有 token 就不建号", async () => {
    await expect(register(FORM)).resolves.toEqual({
      ok: false,
      reason: "email-unverified",
    });

    expect(await getAccountByUsername(USERNAME)).toBeUndefined();
  });

  it("token 的邮箱和表单邮箱不匹配时拒绝", async () => {
    const token = mintToken("other@example.test");

    await expect(register({ ...FORM, token })).resolves.toMatchObject({
      ok: false,
      reason: "email-unverified",
    });
    expect(await getAccountByUsername(USERNAME)).toBeUndefined();
  });

  it("有效 token 建号成功", async () => {
    const token = mintToken(EMAIL);

    await expect(register({ ...FORM, token })).resolves.toMatchObject({
      ok: true,
      username: USERNAME,
    });

    const account = await getAccountByUsername(USERNAME);
    expect(account).toMatchObject({ status: "active", email: EMAIL });
  });

  it("用户名撞车时不消耗 token（可用同一 token 换名重试）", async () => {
    await db.insert(accounts).values({
      username: TAKEN_USERNAME,
      nickname: "占位",
      status: "active",
    });
    const token = mintToken(EMAIL);

    await expect(register({ ...FORM, username: TAKEN_USERNAME, token })).resolves.toEqual({
      ok: false,
      reason: "username-taken",
    });

    await expect(register({ ...FORM, token })).resolves.toMatchObject({
      ok: true,
    });
  });

  it("域名不在允许范围内的邮箱直接拒绝", async () => {
    const token = mintToken("someone@elsewhere.invalid");
    await expect(
      register({ ...FORM, email: "someone@elsewhere.invalid", token }),
    ).resolves.toEqual({ ok: false, reason: "email-domain" });
  });

  it("写密码失败时整笔回滚，不留下一个登不进去的账号", async () => {
    const token = mintToken(EMAIL);
    passwordHook.failSetPassword = true;

    await expect(register({ ...FORM, token })).rejects.toThrow(
      "写密码故意失败",
    );

    expect(await getAccountByUsername(USERNAME)).toBeUndefined();

    passwordHook.failSetPassword = false;
    await expect(register({ ...FORM, token })).resolves.toMatchObject({
      ok: true,
      username: USERNAME,
    });
  });
});
