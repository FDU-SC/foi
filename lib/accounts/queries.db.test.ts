import { desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { accounts, accountSuspensions } from "@/lib/db/schema";
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
  await db
    .delete(accountSuspensions)
    .where(eq(accountSuspensions.handle, HANDLE));
  await db.delete(accounts).where(eq(accounts.handle, HANDLE));
}

async function latestEvent() {
  const [row] = await db
    .select()
    .from(accountSuspensions)
    .where(eq(accountSuspensions.handle, HANDLE))
    .orderBy(desc(accountSuspensions.createdAt))
    .limit(1);
  return row;
}

async function allEvents() {
  return db
    .select()
    .from(accountSuspensions)
    .where(eq(accountSuspensions.handle, HANDLE))
    .orderBy(accountSuspensions.createdAt);
}

describeDb("封禁与解封的审计事件", () => {
  beforeEach(async () => {
    await cleanup();
    await db.insert(accounts).values({
      handle: HANDLE,
      displayName: "Moderation",
      email: `${HANDLE}@example.test`,
      status: "active",
    });
  });

  afterAll(cleanup);

  it("封禁更新 status 并写入一条 suspend 事件", async () => {
    const row = await suspendAccount(HANDLE, MODERATOR, "刷题机器人");

    expect(row?.status).toBe("suspended");

    const event = await latestEvent();
    expect(event?.action).toBe("suspend");
    expect(event?.performedBy).toBe(MODERATOR);
    expect(event?.reason).toBe("刷题机器人");
    expect(event?.createdAt).toBeInstanceOf(Date);
  });

  it("解封更新 status 并写入一条 reinstate 事件", async () => {
    await suspendAccount(HANDLE, MODERATOR, "刷题机器人");
    const row = await reinstateAccount(HANDLE, MODERATOR);

    expect(row?.status).toBe("active");

    const events = await allEvents();
    expect(events).toHaveLength(2);
    expect(events[0].action).toBe("suspend");
    expect(events[1].action).toBe("reinstate");
    expect(events[1].performedBy).toBe(MODERATOR);
    expect(events[1].createdAt.getTime()).toBeGreaterThanOrEqual(
      events[0].createdAt.getTime(),
    );
  });

  it("再次封禁追加事件，历史事件不会被覆盖", async () => {
    await suspendAccount(HANDLE, MODERATOR, "第一次");
    await reinstateAccount(HANDLE, MODERATOR);
    const row = await suspendAccount(HANDLE, MODERATOR, "第二次");

    expect(row?.status).toBe("suspended");

    const events = await allEvents();
    expect(events).toHaveLength(3);
    expect(events[0].reason).toBe("第一次");
    expect(events[1].action).toBe("reinstate");
    expect(events[2].reason).toBe("第二次");
  });

  it("解封后 status 是唯一能回答「此刻封着没有」的列", async () => {
    await suspendAccount(HANDLE, MODERATOR, "刷题机器人");
    await reinstateAccount(HANDLE, MODERATOR);

    const row = await getAccount(HANDLE);

    expect(row?.status).toBe("active");
  });
});
