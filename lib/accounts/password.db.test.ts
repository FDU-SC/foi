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

async function signIn(password: string): Promise<number | null> {
  const check = await verifyPassword(HANDLE, password);
  return check.ok ? check.setAt.getTime() : null;
}

async function stillValid(passwordAt: number): Promise<boolean> {
  return sessionMatchesPassword(await passwordSetAt(HANDLE), passwordAt);
}

describeDb("password", () => {
  beforeEach(async () => {
    await db.delete(accounts).where(eq(accounts.handle, HANDLE));
    await db.insert(accounts).values({
      handle: HANDLE,
      displayName: "Credential Test",
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

  it("给不存在的账号设密码会抛错，而不是静默地什么都没改", async () => {
    await expect(setPassword("nobody-here", PASSWORD)).rejects.toThrow(
      "nobody-here",
    );
  });

  it("新建的账号两列都是空，设过密码之后两列都有值", async () => {
    await db.delete(accounts).where(eq(accounts.handle, HANDLE));
    await db.insert(accounts).values({
      handle: HANDLE,
      displayName: "Credential Test",
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

    await expect(stillValid(0)).resolves.toBe(false);
  });

  it("passwordSetAt 由数据库的时钟写入，而不是这个进程的", async () => {

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
