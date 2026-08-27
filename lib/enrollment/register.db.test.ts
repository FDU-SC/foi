import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccount } from "@/lib/accounts/queries";
import { reservedHandle } from "@/test/content-shapes";
import { db } from "@/lib/db";
import { accounts, emailVerifications } from "@/lib/db/schema";
import { issueCode, verifyCode } from "./email-verification";
import { issueRegistrationProof } from "./registration-proof";
import { register } from "./register";

const EMAIL = "regtest@example.test";
const HANDLE = "regtest";
const TAKEN = "regtest-taken";

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

async function prove(email: string): Promise<string> {
  const issued = await issueCode(email);
  if (!issued.ok) throw new Error("发码被节流");
  await verifyCode(email, issued.code);
  return issueRegistrationProof(email);
}

async function cleanup(): Promise<void> {
  const handles = [HANDLE, TAKEN];
  await db.delete(accounts).where(inArray(accounts.handle, handles));
  await db.delete(emailVerifications).where(eq(emailVerifications.email, EMAIL));
}

const FORM = {
  handle: HANDLE,
  displayName: "注册测试",
  email: EMAIL,
  password: "correct-horse-battery",
  proof: undefined,
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

  it("邮箱没验证过就不建号", async () => {
    await expect(register(FORM)).resolves.toEqual({
      ok: false,
      reason: "email-unverified",
    });

    expect(await getAccount(HANDLE)).toBeUndefined();
  });

  it("只发了码但没验证，同样不建号", async () => {
    const issued = await issueCode(EMAIL);
    expect(issued.ok).toBe(true);

    await expect(register(FORM)).resolves.toMatchObject({
      ok: false,
      reason: "email-unverified",
    });
    expect(await getAccount(HANDLE)).toBeUndefined();
  });

  it("验证过之后建号，并且一建就是 active", async () => {
    const proof = await prove(EMAIL);

    await expect(register({ ...FORM, proof })).resolves.toMatchObject({
      ok: true,
      handle: HANDLE,
    });

    const account = await getAccount(HANDLE);
    expect(account).toMatchObject({ status: "active", email: EMAIL });
  });

  it("建号之后验证行被消费掉，不能拿来再注册一个", async () => {
    const proof = await prove(EMAIL);
    await register({ ...FORM, proof });

    const rows = await db
      .select()
      .from(emailVerifications)
      .where(eq(emailVerifications.email, EMAIL));
    expect(rows).toHaveLength(0);
  });

  it("用户名撞车不会浪费掉这次验证", async () => {

    await db.insert(accounts).values({
      handle: TAKEN,
      displayName: "占位",
      status: "active",
    });
    const proof = await prove(EMAIL);

    await expect(register({ ...FORM, handle: TAKEN, proof })).resolves.toEqual({
      ok: false,
      reason: "handle-taken",
    });

    await expect(register({ ...FORM, proof })).resolves.toMatchObject({
      ok: true,
    });
  });

  it("保留用户名即使验证过也拒绝", async () => {

    const proof = await prove(EMAIL);

    await expect(
      register({ ...FORM, handle: reservedHandle(), proof }),
    ).resolves.toEqual({
      ok: false,
      reason: "handle-reserved",
    });
  });

  it("邮箱已验证但没有本浏览器的证明，不建号", async () => {
    await prove(EMAIL);

    await expect(register(FORM)).resolves.toEqual({
      ok: false,
      reason: "email-unverified",
    });
    expect(await getAccount(HANDLE)).toBeUndefined();
  });

  it("别人邮箱的证明不能拿来注册这个邮箱", async () => {
    await prove(EMAIL);
    const other = issueRegistrationProof("someone-else@example.test");

    await expect(register({ ...FORM, proof: other })).resolves.toEqual({
      ok: false,
      reason: "email-unverified",
    });
    expect(await getAccount(HANDLE)).toBeUndefined();
  });

  it("域名不在允许范围内的邮箱直接拒绝", async () => {
    await expect(
      register({ ...FORM, email: "someone@elsewhere.invalid" }),
    ).resolves.toEqual({ ok: false, reason: "email-domain" });
  });

  it("写密码失败时整笔回滚，不留下一个登不进去的账号", async () => {
    const proof = await prove(EMAIL);
    passwordHook.failSetPassword = true;

    await expect(register({ ...FORM, proof })).rejects.toThrow(
      "写密码故意失败",
    );

    expect(await getAccount(HANDLE)).toBeUndefined();

    passwordHook.failSetPassword = false;
    await expect(register({ ...FORM, proof })).resolves.toMatchObject({
      ok: true,
      handle: HANDLE,
    });
  });
});
