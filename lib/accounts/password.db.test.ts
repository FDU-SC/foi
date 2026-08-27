import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import {
  passwordSetAt,
  sessionMatchesPassword,
  setPassword,
  verifyPassword,
} from "./password";

/**
 * The half of session lifetime that lives in SQL.
 *
 * Whether a reset ends the sessions that came before it is decided by two
 * timestamps: the one frozen into a JWT at sign-in, and the one the row
 * carries now. Neither is a property of the TypeScript around them, so these
 * run against a real Postgres and skip themselves when there is none.
 *
 * Both of those timestamps are values of the same column, so the cases below
 * are only meaningful while one clock writes it. They used to fail whenever
 * the database's clock ran far enough ahead of this process's: `setPassword`
 * stamped the row from here and the row it was overwriting had been stamped
 * over there, so a reset could land *before* the session it was ending. The
 * last case in this file is the one that holds that down — it compares against
 * the database's clock rather than against elapsed wall time, so it bites on a
 * machine whose two clocks happen to agree as well as on one whose do not.
 */
const HANDLE = "credtest";
const PASSWORD = "correct-horse-battery";

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
  console.warn("[test] 数据库不可达，跳过密码集成用例");
}

/** What `authorize` freezes into the token when somebody signs in. */
async function signIn(password: string): Promise<number | null> {
  const check = await verifyPassword(HANDLE, password);
  return check.ok ? check.setAt.getTime() : null;
}

/** What `getResolvedUser` asks on every request that carries that token. */
async function stillValid(passwordAt: number): Promise<boolean> {
  return sessionMatchesPassword(await passwordSetAt(HANDLE), passwordAt);
}

describeDb("password", () => {
  beforeEach(async () => {
    await db.delete(accounts).where(eq(accounts.handle, HANDLE));
    await db.insert(accounts).values({
      handle: HANDLE,
      displayName: "Credential Test",
      source: "registration",
    });
    await setPassword(HANDLE, PASSWORD);
  });

  afterAll(async () => {
    await db.delete(accounts).where(eq(accounts.handle, HANDLE));
  });

  it("密码正确时给出该行的 passwordSetAt", async () => {
    const check = await verifyPassword(HANDLE, PASSWORD);

    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.setAt).toEqual(await passwordSetAt(HANDLE));
    }
  });

  it("密码错误时不给 passwordSetAt", async () => {
    await expect(verifyPassword(HANDLE, "wrong")).resolves.toEqual({
      ok: false,
    });
  });

  it("没有账号的 handle 也返回 ok: false", async () => {
    await expect(verifyPassword("nobody-here", PASSWORD)).resolves.toEqual({
      ok: false,
    });
    await expect(passwordSetAt("nobody-here")).resolves.toBeNull();
  });

  /**
   * What the foreign key used to refuse. A password row with nobody behind it
   * could not be written at all; an `update` naming a handle nobody registered
   * matches nothing and reports success, so the refusal has to be written out.
   */
  it("给不存在的账号设密码会抛错，而不是静默地什么都没改", async () => {
    await expect(setPassword("nobody-here", PASSWORD)).rejects.toThrow(
      "nobody-here",
    );
  });

  /** The check constraint is what lets `passwordSetAt` stand in for the hash. */
  it("新建的账号两列都是空，设过密码之后两列都有值", async () => {
    await db.delete(accounts).where(eq(accounts.handle, HANDLE));
    await db.insert(accounts).values({
      handle: HANDLE,
      displayName: "Credential Test",
      source: "registration",
    });

    await expect(passwordSetAt(HANDLE)).resolves.toBeNull();
    await setPassword(HANDLE, PASSWORD);
    await expect(passwordSetAt(HANDLE)).resolves.not.toBeNull();
  });

  it("刚签发的会话立刻就是有效的", async () => {
    const issued = await signIn(PASSWORD);

    expect(issued).not.toBeNull();
    await expect(stillValid(issued!)).resolves.toBe(true);
  });

  it("改密码之后，改密之前签发的会话失效", async () => {
    const stolen = await signIn(PASSWORD);
    await expect(stillValid(stolen!)).resolves.toBe(true);

    // Exactly what resetPasswordAction does once the token is redeemed.
    await setPassword(HANDLE, "brand-new-password");

    await expect(stillValid(stolen!)).resolves.toBe(false);
  });

  it("改密之后新签发的会话是有效的", async () => {
    const stolen = await signIn(PASSWORD);
    await setPassword(HANDLE, "brand-new-password");

    const fresh = await signIn("brand-new-password");

    await expect(stillValid(fresh!)).resolves.toBe(true);
    await expect(stillValid(stolen!)).resolves.toBe(false);
  });

  it("setPassword 会把 passwordSetAt 往前推", async () => {
    const before = await passwordSetAt(HANDLE);
    await setPassword(HANDLE, "another-one");
    const after = await passwordSetAt(HANDLE);

    expect(after!.getTime()).toBeGreaterThan(before!.getTime());
  });

  it("没有 passwordAt 声明的旧 token 一律失效", async () => {
    // Tokens minted before the claim existed decode to 0.
    await expect(stillValid(0)).resolves.toBe(false);
  });

  it("passwordSetAt 由数据库的时钟写入，而不是这个进程的", async () => {
    // `now()` is the transaction's timestamp and does not move within one, so
    // this is an equality rather than a tolerance: whatever `setPassword`
    // writes inside this transaction either is that timestamp or came from
    // somewhere else. A `new Date()` would be somewhere else even on a machine
    // whose two clocks agree perfectly — argon2 alone puts tens of
    // milliseconds between the two.
    await db.transaction(async (tx) => {
      const [opened] = await tx
        .select({ at: sql<Date>`now()` })
        .from(accounts)
        .where(eq(accounts.handle, HANDLE));

      await setPassword(HANDLE, "written-inside-a-transaction", tx);

      const [row] = await tx
        .select({ passwordSetAt: accounts.passwordSetAt })
        .from(accounts)
        .where(eq(accounts.handle, HANDLE));

      expect(row.passwordSetAt!.getTime()).toBe(new Date(opened.at).getTime());
    });
  });
});
