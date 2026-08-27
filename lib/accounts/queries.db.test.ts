import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { getAccount, reinstateAccount, suspendAccount } from "./queries";

const HANDLE = "queries-moderation";
const MODERATOR = "queries-moderator";

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
  console.warn("[test] 数据库不可达，跳过封禁审计集成用例");
}

async function cleanup() {
  await db.delete(accounts).where(eq(accounts.handle, HANDLE));
}

describeDb("封禁与解封的审计列", () => {
  beforeEach(async () => {
    await cleanup();
    await db.insert(accounts).values({
      handle: HANDLE,
      displayName: "Moderation",
      email: `${HANDLE}@example.test`,
      source: "registration",
      status: "active",
    });
  });

  afterAll(cleanup);

  it("封禁写下四列里的三列，解封时间保持为空", async () => {
    const row = await suspendAccount(HANDLE, MODERATOR, "刷题机器人");

    expect(row?.status).toBe("suspended");
    expect(row?.suspendedAt).toBeInstanceOf(Date);
    expect(row?.suspendedBy).toBe(MODERATOR);
    expect(row?.suspendedReason).toBe("刷题机器人");
    expect(row?.reinstatedAt).toBeNull();
  });

  it("解封保留封禁记录，并记下放出来的时间", async () => {
    await suspendAccount(HANDLE, MODERATOR, "刷题机器人");
    const row = await reinstateAccount(HANDLE);

    expect(row?.status).toBe("active");
    expect(row?.suspendedBy).toBe(MODERATOR);
    expect(row?.suspendedReason).toBe("刷题机器人");
    expect(row?.reinstatedAt).toBeInstanceOf(Date);
    expect(row?.reinstatedAt!.getTime()).toBeGreaterThanOrEqual(
      row!.suspendedAt!.getTime(),
    );
  });

  it("再次封禁清空解封时间，四列因此始终描述同一次处置", async () => {
    await suspendAccount(HANDLE, MODERATOR, "第一次");
    await reinstateAccount(HANDLE);
    const row = await suspendAccount(HANDLE, MODERATOR, "第二次");

    expect(row?.status).toBe("suspended");
    expect(row?.suspendedReason).toBe("第二次");
    expect(row?.reinstatedAt).toBeNull();
  });

  it("解封后 status 是唯一能回答「此刻封着没有」的列", async () => {
    await suspendAccount(HANDLE, MODERATOR, "刷题机器人");
    await reinstateAccount(HANDLE);

    const row = await getAccount(HANDLE);

    expect(row?.status).toBe("active");
    expect(row?.suspendedAt).not.toBeNull();
  });
});
