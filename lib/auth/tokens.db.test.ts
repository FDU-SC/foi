import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { accounts, authTokens } from "@/lib/db/schema";
import {
  inspectToken,
  issueToken,
  lastIssuedAt,
  listPendingTokens,
  redeemToken,
  revokeTokens,
} from "./tokens";

/**
 * Token handling is the one part of the auth surface that cannot be tested as
 * a pure function: single-use is a property of the SQL statement, not of the
 * TypeScript around it. These run against a real Postgres and are skipped
 * when there is none, so the unit suite stays runnable on a bare checkout.
 */
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
    await db.delete(authTokens).where(eq(authTokens.handle, HANDLE));
    await db.delete(accounts).where(eq(accounts.handle, HANDLE));
    await db.insert(accounts).values({
      handle: HANDLE,
      displayName: "Token Test",
      source: "registration",
    });
  });

  afterAll(async () => {
    await db.delete(authTokens).where(eq(authTokens.handle, HANDLE));
    await db.delete(accounts).where(eq(accounts.handle, HANDLE));
  });

  it("签发的 token 可以被消费一次", async () => {
    const { token } = await issueToken(HANDLE, "password_reset");

    await expect(redeemToken(token, "password_reset")).resolves.toEqual({
      ok: true,
      handle: HANDLE,
    });
  });

  it("消费过的 token 重放会被拒绝", async () => {
    const { token } = await issueToken(HANDLE, "password_reset");
    await redeemToken(token, "password_reset");

    await expect(redeemToken(token, "password_reset")).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("并发消费同一个 token 只有一个成功", async () => {
    const { token } = await issueToken(HANDLE, "password_reset");

    const results = await Promise.all(
      Array.from({ length: 8 }, () => redeemToken(token, "password_reset")),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });

  it("过期的 token 报 expired 而不是 invalid", async () => {
    const { token } = await issueToken(HANDLE, "password_reset", {
      ttlMs: -1_000,
    });

    await expect(redeemToken(token, "password_reset")).resolves.toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("从未签发过的 token 报 invalid", async () => {
    await expect(
      redeemToken("never-minted-token", "password_reset"),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("expectHandle 与 token 归属不符时拒绝", async () => {
    const { token } = await issueToken(HANDLE, "password_reset");

    await expect(
      redeemToken(token, "password_reset", { expectHandle: "someone-else" }),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("expectHandle 大小写不敏感", async () => {
    const { token } = await issueToken(HANDLE, "password_reset");

    await expect(
      redeemToken(token, "password_reset", {
        expectHandle: HANDLE.toUpperCase(),
      }),
    ).resolves.toEqual({ ok: true, handle: HANDLE });
  });

  it("重新签发会作废上一个未消费的 token", async () => {
    const first = await issueToken(HANDLE, "password_reset");
    const second = await issueToken(HANDLE, "password_reset");

    await expect(
      redeemToken(first.token, "password_reset"),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      redeemToken(second.token, "password_reset"),
    ).resolves.toMatchObject({ ok: true });
  });

  it("revokeTokens 之后原 token 失效", async () => {
    const { token } = await issueToken(HANDLE, "password_reset");
    await revokeTokens(HANDLE, "password_reset");

    await expect(
      redeemToken(token, "password_reset"),
    ).resolves.toMatchObject({ ok: false });
  });

  it("inspectToken 不消费 token，并能看出是否已被消费", async () => {
    const { token } = await issueToken(HANDLE, "password_reset");

    expect(await inspectToken(token, "password_reset")).toMatchObject({
      handle: HANDLE,
      consumedAt: null,
    });

    await redeemToken(token, "password_reset");

    const after = await inspectToken(token, "password_reset");
    expect(after?.consumedAt).toBeInstanceOf(Date);
  });

  it("lastIssuedAt 反映最近一次签发，用于重发节流", async () => {
    expect(await lastIssuedAt(HANDLE, "password_reset")).toBeNull();

    await issueToken(HANDLE, "password_reset");

    const issued = await lastIssuedAt(HANDLE, "password_reset");
    expect(issued).toBeInstanceOf(Date);
    expect(Date.now() - (issued?.getTime() ?? 0)).toBeLessThan(10_000);
  });

  it("listPendingTokens 只列出未消费且未过期的", async () => {
    const stale = await issueToken(HANDLE, "password_reset", { ttlMs: -1_000 });

    const mine = () =>
      listPendingTokens().then((rows) =>
        rows.filter((row) => row.handle === HANDLE),
      );

    expect(await mine()).toHaveLength(0);
    // 行本身还在，只是不再算作「待用」。
    expect(await inspectToken(stale.token, "password_reset")).not.toBeNull();

    await issueToken(HANDLE, "password_reset");
    expect(await mine()).toHaveLength(1);
  });
});
