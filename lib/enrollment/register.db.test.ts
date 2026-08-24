import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccount } from "@/lib/accounts/queries";
import { issueCode, verifyCode } from "@/lib/auth/email-verification";
import { issueRegistrationProof } from "@/lib/auth/registration-proof";
import { db } from "@/lib/db";
import { accounts, credentials, emailVerifications } from "@/lib/db/schema";
import { register } from "./register";

/**
 * The invariant this whole flow exists for: no proof of the address, no
 * account. It is enforced in `register()` rather than in the form, so this is
 * where it has to be checked — a test that went through the form would only
 * establish that the form does what the form does.
 *
 * Reads the real `content/enrollment/example.ts` policy, which is why the
 * addresses below are `@example.test` and the reserved handles are its.
 */
const EMAIL = "regtest@example.test";
const HANDLE = "regtest";
const TAKEN = "regtest-taken";

/**
 * A switch for making the middle of the three writes fail.
 *
 * `setPassword` is the only one that can be made to fail without inventing a
 * database error: the other two are an upsert and a delete against rows these
 * tests own, and both succeed by construction. Wrapped rather than replaced so
 * every other case in this file goes on exercising the real one — a stub that
 * never writes a hash would make the successful paths prove less than they
 * look like they prove.
 */
const credentialsHook = vi.hoisted(() => ({ failSetPassword: false }));

vi.mock("@/lib/auth/credentials", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/credentials")>();
  return {
    ...actual,
    setPassword: async (...args: Parameters<typeof actual.setPassword>) => {
      if (credentialsHook.failSetPassword) throw new Error("写密码故意失败");
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
  await db.delete(credentials).where(inArray(credentials.handle, handles));
  await db.delete(accounts).where(inArray(accounts.handle, handles));
  await db.delete(emailVerifications).where(eq(emailVerifications.email, EMAIL));
}

/**
 * A filled-in form with no proof cookie attached, which is what a request that
 * skipped the verify step looks like. Cases that did verify spread a proof
 * over the top. `proof` is spelled out rather than omitted because `register`
 * requires the field: a caller with nothing to offer says so.
 */
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
    credentialsHook.failSetPassword = false;
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
    expect(account?.emailVerifiedAt).toBeInstanceOf(Date);
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
    // 这正是发码/验证要和最终提交分开的理由：换个用户名就能接着注册，
    // 不必为一个和邮箱无关的错误再跑一趟收件箱。
    await db.insert(accounts).values({
      handle: TAKEN,
      displayName: "占位",
      source: "registration",
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

    await expect(register({ ...FORM, handle: "root", proof })).resolves.toEqual({
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
    credentialsHook.failSetPassword = true;

    await expect(register({ ...FORM, proof })).rejects.toThrow(
      "写密码故意失败",
    );

    // 账号行是在抛错之前就插进去的，所以它现在不在，只可能是回滚的结果。
    // 没有事务的时候留下的正是这一行：账号存在、没有凭据、登不进去，而且
    // 注册页会告诉这个人用户名已被占用——占用者是他自己。
    expect(await getAccount(HANDLE)).toBeUndefined();
    await expect(
      db.select().from(credentials).where(eq(credentials.handle, HANDLE)),
    ).resolves.toHaveLength(0);

    // 邮箱证明也没被花掉，所以重试一次就能过，不必再跑一趟收件箱。
    credentialsHook.failSetPassword = false;
    await expect(register({ ...FORM, proof })).resolves.toMatchObject({
      ok: true,
      handle: HANDLE,
    });
  });
});
