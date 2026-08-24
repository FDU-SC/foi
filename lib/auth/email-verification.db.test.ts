import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { emailVerifications } from "@/lib/db/schema";
import {
  consumeVerifiedEmail,
  isEmailVerified,
  issueCode,
  maxAttempts,
  purgeExpiredVerifications,
  verifyCode,
} from "./email-verification";

/**
 * Like the token suite next door, this cannot be a unit test: the attempt cap
 * and the resend cooldown are properties of the SQL statements, not of the
 * TypeScript wrapped around them. Runs against a real Postgres and skips
 * itself when there is none.
 */
const EMAIL = "verify-test@example.test";
const OTHER = "verify-other@example.test";

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
  console.warn("[test] 数据库不可达，跳过邮箱验证码集成用例");
}

/** Time travel. Both deadlines live on the row, so both move together. */
async function age(email: string, ms: number): Promise<void> {
  const [row] = await db
    .select()
    .from(emailVerifications)
    .where(eq(emailVerifications.email, email));

  await db
    .update(emailVerifications)
    .set({
      createdAt: new Date(row.createdAt.getTime() - ms),
      expiresAt: new Date(row.expiresAt.getTime() - ms),
    })
    .where(eq(emailVerifications.email, email));
}

/** Past the cooldown, so a test can mint a second code without waiting. */
async function issueFresh(email: string): Promise<string> {
  const first = await issueCode(email);
  if (first.ok) return first.code;

  await age(email, 61_000);
  const retry = await issueCode(email);
  if (!retry.ok) throw new Error("发码仍被节流");
  return retry.code;
}

async function cleanup(): Promise<void> {
  for (const email of [EMAIL, OTHER]) {
    await db.delete(emailVerifications).where(eq(emailVerifications.email, email));
  }
}

describeDb("邮箱验证码", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it("正确的验证码通过，并让邮箱进入已验证状态", async () => {
    const code = await issueFresh(EMAIL);

    expect(await isEmailVerified(EMAIL)).toBe(false);
    await expect(verifyCode(EMAIL, code)).resolves.toEqual({ ok: true });
    expect(await isEmailVerified(EMAIL)).toBe(true);
  });

  it("错误的验证码被拒，并且报出还剩几次", async () => {
    await issueFresh(EMAIL);

    await expect(verifyCode(EMAIL, "000000")).resolves.toEqual({
      ok: false,
      reason: "mismatch",
      attemptsLeft: maxAttempts - 1,
    });
    await expect(verifyCode(EMAIL, "000001")).resolves.toEqual({
      ok: false,
      reason: "mismatch",
      attemptsLeft: maxAttempts - 2,
    });
  });

  it("错满上限后这一份就作废，正确的码也不再被接受", async () => {
    const code = await issueFresh(EMAIL);
    const wrong = code === "999999" ? "000000" : "999999";

    for (let i = 0; i < maxAttempts; i += 1) {
      await verifyCode(EMAIL, wrong);
    }

    await expect(verifyCode(EMAIL, code)).resolves.toEqual({
      ok: false,
      reason: "too-many-attempts",
      attemptsLeft: 0,
    });
    expect(await isEmailVerified(EMAIL)).toBe(false);
  });

  it("并发猜测不会突破上限", async () => {
    await issueFresh(EMAIL);

    // 一起打进来的 20 次猜测，只应该消耗掉上限那么多次尝试。先读后写的
    // 计数在这里会全部放行，这正是要防的。
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        verifyCode(EMAIL, String(i).padStart(6, "0")),
      ),
    );

    const [row] = await db
      .select({ attempts: emailVerifications.attempts })
      .from(emailVerifications)
      .where(eq(emailVerifications.email, EMAIL));

    expect(row.attempts).toBe(maxAttempts);
  });

  it("过期的验证码报 expired", async () => {
    const code = await issueFresh(EMAIL);
    await age(EMAIL, 11 * 60 * 1000);

    await expect(verifyCode(EMAIL, code)).resolves.toEqual({
      ok: false,
      reason: "expired",
      attemptsLeft: 0,
    });
  });

  it("从没发过码的邮箱报 no-code", async () => {
    await expect(verifyCode(EMAIL, "123456")).resolves.toEqual({
      ok: false,
      reason: "no-code",
      attemptsLeft: 0,
    });
  });

  it("一分钟内重发被节流", async () => {
    await expect(issueCode(EMAIL)).resolves.toMatchObject({ ok: true });

    const again = await issueCode(EMAIL);
    expect(again).toMatchObject({ ok: false, reason: "throttled" });
    if (!again.ok) {
      expect(again.retryAfterMs).toBeGreaterThan(0);
      expect(again.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
  });

  it("重新发码会作废上一个码，并把尝试次数清零", async () => {
    const first = await issueFresh(EMAIL);
    await verifyCode(EMAIL, "000000");

    await age(EMAIL, 61_000);
    const second = await issueCode(EMAIL);
    if (!second.ok) throw new Error("发码被节流");

    await expect(verifyCode(EMAIL, first)).resolves.toMatchObject({
      ok: false,
      reason: "mismatch",
      attemptsLeft: maxAttempts - 1,
    });
    await expect(verifyCode(EMAIL, second.code)).resolves.toEqual({ ok: true });
  });

  it("发给一个邮箱的码不能用在另一个邮箱上", async () => {
    const code = await issueFresh(EMAIL);
    await issueFresh(OTHER);

    await expect(verifyCode(OTHER, code)).resolves.toMatchObject({
      ok: false,
      reason: "mismatch",
    });
    expect(await isEmailVerified(OTHER)).toBe(false);
  });

  it("重复验证是幂等的，不报错也不消耗次数", async () => {
    const code = await issueFresh(EMAIL);

    await expect(verifyCode(EMAIL, code)).resolves.toEqual({ ok: true });
    await expect(verifyCode(EMAIL, code)).resolves.toEqual({ ok: true });
    expect(await isEmailVerified(EMAIL)).toBe(true);
  });

  it("验证之后的有效期是有限的，过期就不再算已验证", async () => {
    const code = await issueFresh(EMAIL);
    await verifyCode(EMAIL, code);
    expect(await isEmailVerified(EMAIL)).toBe(true);

    await age(EMAIL, 31 * 60 * 1000);
    expect(await isEmailVerified(EMAIL)).toBe(false);
  });

  it("consumeVerifiedEmail 之后不再算已验证", async () => {
    const code = await issueFresh(EMAIL);
    await verifyCode(EMAIL, code);

    await consumeVerifiedEmail(EMAIL);

    expect(await isEmailVerified(EMAIL)).toBe(false);
    const rows = await db
      .select()
      .from(emailVerifications)
      .where(eq(emailVerifications.email, EMAIL));
    expect(rows).toHaveLength(0);
  });

  it("purgeExpiredVerifications 只清理过期的行", async () => {
    await issueFresh(EMAIL);
    await issueFresh(OTHER);
    await age(EMAIL, 11 * 60 * 1000);

    await purgeExpiredVerifications();

    const remaining = await db
      .select({ email: emailVerifications.email })
      .from(emailVerifications);
    const mine = remaining
      .map((row) => row.email)
      .filter((email) => email === EMAIL || email === OTHER);

    expect(mine).toEqual([OTHER]);
  });
});
