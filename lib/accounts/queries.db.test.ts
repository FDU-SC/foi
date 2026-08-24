import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { getAccount, reinstateAccount, suspendAccount } from "./queries";

/**
 * Suspension is the one thing this application keeps in the database rather
 * than in the repository, and until now the pair of functions that writes it
 * had no tests at all. What they get wrong is not the happy path — it is the
 * bookkeeping on either side of it, which is invisible until somebody asks the
 * row a question months later.
 *
 * The four audit columns are the subject. They describe the most recent
 * episode rather than the current state, so every assertion below is about
 * whether an episode stays internally consistent across a transition.
 */
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

  /**
   * The regression this column was added for. Clearing the three on
   * reinstatement erased the whole record; keeping them without a fourth said
   * a suspension had happened but not that it was over.
   */
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

  /**
   * The ordering that must stay unrepresentable. Without the clear in
   * `suspendAccount`, a re-suspended row would carry a reinstatement older
   * than the suspension it supposedly ended — two halves of different
   * episodes, and no reader could tell which.
   */
  it("再次封禁清空解封时间，四列因此始终描述同一次处置", async () => {
    await suspendAccount(HANDLE, MODERATOR, "第一次");
    await reinstateAccount(HANDLE);
    const row = await suspendAccount(HANDLE, MODERATOR, "第二次");

    expect(row?.status).toBe("suspended");
    expect(row?.suspendedReason).toBe("第二次");
    expect(row?.reinstatedAt).toBeNull();
  });

  /**
   * `status` is the only predicate, which is what makes keeping the audit
   * columns safe. Asserted here rather than left to prose because the whole
   * argument for not clearing them rests on it.
   */
  it("解封后 status 是唯一能回答「此刻封着没有」的列", async () => {
    await suspendAccount(HANDLE, MODERATOR, "刷题机器人");
    await reinstateAccount(HANDLE);

    const row = await getAccount(HANDLE);

    expect(row?.status).toBe("active");
    expect(row?.suspendedAt).not.toBeNull();
  });
});
