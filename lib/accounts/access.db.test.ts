import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AS_PLAYER } from "@/test/auth-support";
import { viewerFor } from "@/lib/permissions/viewer";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { accountDirectoryFor, accountsFor } from "./access";
import { viewerWith } from "@/test/content-shapes";

const ACTIVE = "acctaccess-active";
const SUSPENDED = "acctaccess-suspended";

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

const reader = viewerWith("account.read", "acctaccess-admin");
const player = viewerFor({ handle: ACTIVE, groups: [] });

async function cleanup() {
  for (const handle of [ACTIVE, SUSPENDED]) {
    await db.delete(accounts).where(eq(accounts.handle, handle));
  }
}

describeDb("账号目录门禁", () => {
  beforeAll(async () => {
    await cleanup();
    await db.insert(accounts).values([
      {
        handle: ACTIVE,
        displayName: "Active",
        email: `${ACTIVE}@example.test`,
        status: "active",
      },
      {
        handle: SUSPENDED,
        displayName: "Suspended",
        email: `${SUSPENDED}@example.test`,
        status: "suspended",
      },
    ]);
  });

  afterAll(cleanup);

  describe("accountDirectoryFor", () => {
    it("持 account.read 的人拿到目录", async () => {
      const directory = await accountDirectoryFor(reader);

      expect(directory.accounts.map((row) => row.handle)).toContain(ACTIVE);
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

    it("只有 admin.access 而没有 account.read 时读不到邮箱", async () => {
      const consoleOnly = viewerFor({ handle: "x", groups: [] });
      expect(consoleOnly.can("admin.access")).toBe(false);

      const directory = await accountDirectoryFor(consoleOnly);
      expect(directory.accounts).toEqual([]);
    });
  });

  describe("accountsFor", () => {
    it("持 account.read 的人拿到账号", async () => {
      const rows = await accountsFor(reader);
      expect(rows.map((row) => row.handle)).toContain(ACTIVE);
    });

    it("status 过滤下推到查询，封禁的不会出现在 active 里", async () => {
      const rows = await accountsFor(reader, { status: "active" });
      const handles = rows.map((row) => row.handle);

      expect(handles).toContain(ACTIVE);
      expect(handles).not.toContain(SUSPENDED);
    });

    it("没有 account.read 就是空数组，过滤条件也不能放宽它", async () => {
      expect(await accountsFor(player)).toEqual([]);
      expect(await accountsFor(player, { status: "suspended" })).toEqual([]);
    });
  });
});
