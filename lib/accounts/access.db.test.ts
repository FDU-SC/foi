import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AS_PLAYER } from "@/test/auth-support";
import { viewerFor } from "@/lib/authz/viewer";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { accountDirectoryFor, accountsFor } from "./access";
import { viewerAllowedOnly, viewerWith } from "@/test/content-shapes";

const ACTIVE_USERNAME = "acctaccess-active";
const SUSPENDED_USERNAME = "acctaccess-suspended";
let ACTIVE_UID = 0;
let SUSPENDED_UID = 0;

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
  console.warn("[test] 数据库不可达，跳过账号门禁集成用例");
}

const reader = viewerWith("account.read");
const player = viewerFor({ uid: 1, groups: [] });

async function cleanup() {
  if (ACTIVE_UID) {
    await db.delete(accounts).where(eq(accounts.uid, ACTIVE_UID));
  }
  if (SUSPENDED_UID) {
    await db.delete(accounts).where(eq(accounts.uid, SUSPENDED_UID));
  }
}

describeDb("账号目录门禁", () => {
  beforeAll(async () => {
    await cleanup();
    const [active] = await db
      .insert(accounts)
      .values({
        username: ACTIVE_USERNAME,
        nickname: "Active",
        email: `${ACTIVE_USERNAME}@example.test`,
        status: "active",
      })
      .returning({ uid: accounts.uid });
    ACTIVE_UID = active.uid;

    const [suspended] = await db
      .insert(accounts)
      .values({
        username: SUSPENDED_USERNAME,
        nickname: "Suspended",
        email: `${SUSPENDED_USERNAME}@example.test`,
        status: "suspended",
      })
      .returning({ uid: accounts.uid });
    SUSPENDED_UID = suspended.uid;
  });

  afterAll(cleanup);

  describe("accountDirectoryFor", () => {
    it("持 account.read 的人拿到目录", async () => {
      const directory = await accountDirectoryFor(reader);

      expect(directory.accounts.map((row) => row.uid)).toContain(ACTIVE_UID);
    });

    it("目录里的行不带 passwordHash", async () => {
      const directory = await accountDirectoryFor(reader);

      for (const row of directory.accounts) {
        expect(row).not.toHaveProperty("passwordHash");
      }
    });

    it("选手拿到的是空目录，而不是异常", async () => {
      const directory = await accountDirectoryFor(player);

      expect(directory.accounts).toEqual([]);
    });

    it("匿名也是空目录", async () => {
      expect((await accountDirectoryFor(AS_PLAYER)).accounts).toEqual([]);
    });

    it("能进运维台不等于能读邮箱", async () => {
      const consoleOnly = viewerAllowedOnly("admin.enter", "account.read", 2);

      const directory = await accountDirectoryFor(consoleOnly);
      expect(directory.accounts).toEqual([]);
    });
  });

  describe("accountsFor", () => {
    it("持 account.read 的人拿到账号", async () => {
      const rows = await accountsFor(reader);
      expect(rows.map((row) => row.uid)).toContain(ACTIVE_UID);
    });

    it("status 过滤下推到查询，封禁的不会出现在 active 里", async () => {
      const rows = await accountsFor(reader, { status: "active" });
      const uids = rows.map((row) => row.uid);

      expect(uids).toContain(ACTIVE_UID);
      expect(uids).not.toContain(SUSPENDED_UID);
    });

    it("没有 account.read 就是空数组，过滤条件也不能放宽它", async () => {
      expect(await accountsFor(player)).toEqual([]);
      expect(await accountsFor(player, { status: "suspended" })).toEqual([]);
    });
  });
});
