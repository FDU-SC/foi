import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { accounts, passwordResetTokens } from "@/lib/db/schema";
import {
  issueToken,
  lastIssuedAt,
  listPendingTokens,
  redeemToken,
  revokeTokens,
} from "./tokens";

const HANDLE = "tokentest";

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
  console.warn("[test] 数据库不可达，跳过 token 集成用例");
}

describeDb("auth tokens", () => {
  beforeEach(async () => {
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.handle, HANDLE));
    await db.delete(accounts).where(eq(accounts.handle, HANDLE));
    await db.insert(accounts).values({
      handle: HANDLE,
      displayName: "Token Test",
    });
  });

  afterAll(async () => {
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.handle, HANDLE));
    await db.delete(accounts).where(eq(accounts.handle, HANDLE));
  });

  it("签发的 token 可以被消费一次", async () => {
    const { token } = await issueToken(HANDLE);

    await expect(redeemToken(token)).resolves.toEqual({
      ok: true,
      handle: HANDLE,
    });
  });

  it("消费过的 token 重放会被拒绝", async () => {
    const { token } = await issueToken(HANDLE);
    await redeemToken(token);

    await expect(redeemToken(token)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("并发消费同一个 token 只有一个成功", async () => {
    const { token } = await issueToken(HANDLE);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => redeemToken(token)),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });

  it("过期的 token 报 expired 而不是 invalid", async () => {
    const { token } = await issueToken(HANDLE, {
      ttlMs: -1_000,
    });

    await expect(redeemToken(token)).resolves.toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("从未签发过的 token 报 invalid", async () => {
    await expect(
      redeemToken("never-minted-token"),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("重新签发会作废上一个未消费的 token", async () => {
    const first = await issueToken(HANDLE);
    const second = await issueToken(HANDLE);

    await expect(
      redeemToken(first.token),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      redeemToken(second.token),
    ).resolves.toMatchObject({ ok: true });
  });

  it("revokeTokens 之后原 token 失效", async () => {
    const { token } = await issueToken(HANDLE);
    await revokeTokens(HANDLE);

    await expect(
      redeemToken(token),
    ).resolves.toMatchObject({ ok: false });
  });

  it("revokePrior: false 时不动上一个 token", async () => {
    const first = await issueToken(HANDLE);
    const second = await issueToken(HANDLE, {
      revokePrior: false,
    });

    await expect(
      redeemToken(first.token),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      redeemToken(second.token),
    ).resolves.toMatchObject({ ok: true });
  });

  it("exceptId 作废其余的，独独留下点名的那一个", async () => {
    const first = await issueToken(HANDLE);
    const second = await issueToken(HANDLE, {
      revokePrior: false,
    });

    await revokeTokens(HANDLE, { exceptId: second.id });

    await expect(
      redeemToken(first.token),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      redeemToken(second.token),
    ).resolves.toMatchObject({ ok: true });
  });

  it("同一事务里回滚时 token 没有被花掉，链接还能再用一次", async () => {
    const { token } = await issueToken(HANDLE);

    let redeemed;
    await expect(
      db.transaction(async (tx) => {
        redeemed = await redeemToken(token, tx);

        throw new Error("写密码故意失败");
      }),
    ).rejects.toThrow("写密码故意失败");

    expect(redeemed).toEqual({ ok: true, handle: HANDLE });

    await expect(redeemToken(token)).resolves.toEqual({
      ok: true,
      handle: HANDLE,
    });
  });

  it("lastIssuedAt 反映最近一次签发，用于重发节流", async () => {
    expect(await lastIssuedAt(HANDLE)).toBeNull();

    await issueToken(HANDLE);

    const issued = await lastIssuedAt(HANDLE);
    expect(issued).toBeInstanceOf(Date);
    expect(Date.now() - (issued?.getTime() ?? 0)).toBeLessThan(10_000);
  });

  it("listPendingTokens 只列出未消费且未过期的", async () => {
    await issueToken(HANDLE, { ttlMs: -1_000 });

    const mine = () =>
      listPendingTokens().then((rows) =>
        rows.filter((row) => row.handle === HANDLE),
      );

    expect(await mine()).toHaveLength(0);

    const stored = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.handle, HANDLE));
    expect(stored).toHaveLength(1);

    await issueToken(HANDLE);
    expect(await mine()).toHaveLength(1);
  });
});
