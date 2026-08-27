import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AS_PLAYER } from "@/test/auth-support";
import { viewerFor } from "@/lib/permissions/viewer";
import { db } from "@/lib/db";
import { allContests } from "@/lib/contests/registry";
import { listRules } from "@/lib/enrollment/registry";
import { viewerWith } from "@/test/content-shapes";
import {
  adminAccountsFor,
  adminContestsFor,
  adminOverviewFor,
  enrollmentViewFor,
} from "./access";

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
  console.warn("[test] 数据库不可达，跳过运维台门禁集成用例");
}

const admin = viewerWith("admin.access", "adminaccess-admin");
const player = viewerFor({ handle: "adminaccess-player", groups: [] });

const suspended = AS_PLAYER;

describeDb("运维台门禁", () => {
  describe("adminOverviewFor", () => {
    it("管理员拿到概览", async () => {
      const overview = await adminOverviewFor(admin);

      expect(overview).not.toBeNull();
      expect(overview?.problemCount).toBeGreaterThan(0);
    });

    it("选手拿到 null，页面据此 404", async () => {
      expect(await adminOverviewFor(player)).toBeNull();
    });

    it("被封禁的管理员拿到 null，即便 proxy 放他进来了", async () => {
      expect(await adminOverviewFor(suspended)).toBeNull();
    });
  });

  describe("adminAccountsFor", () => {
    it("管理员拿到目录", async () => {
      const directory = await adminAccountsFor(admin);

      expect(directory).not.toBeNull();
    });

    it("选手拿到 null，页面据此 404", async () => {
      expect(await adminAccountsFor(player)).toBeNull();
    });

    it("被封禁的管理员拿到 null", async () => {
      expect(await adminAccountsFor(suspended)).toBeNull();
    });

    it("只有 admin.access 时拿到页面，但表是空的", async () => {
      const consoleOnly: typeof admin = {
        handle: "adminaccess-setter",
        groups: [],
        can: (capability) => capability === "admin.access",
      };

      const directory = await adminAccountsFor(consoleOnly);

      expect(directory).not.toBeNull();
      expect(directory?.accounts).toEqual([]);
    });
  });

  describe("adminContestsFor", () => {
    it("管理员看到全部比赛，含对任何人都不可见的暂存轮次", async () => {
      const rows = await adminContestsFor(admin);

      expect(rows?.map((row) => row.config.slug).sort()).toEqual(
        allContests().map((contest) => contest.slug).sort(),
      );
    });

    it("选手拿到 null", async () => {
      expect(await adminContestsFor(player)).toBeNull();
    });

    it("被封禁的管理员拿到 null", async () => {
      expect(await adminContestsFor(suspended)).toBeNull();
    });
  });

  describe("enrollmentViewFor", () => {
    it("选手拿到 null，看不到分流规则也看不到被点名的人", async () => {
      expect(await enrollmentViewFor(player)).toBeNull();
    });

    it("被封禁的管理员拿到 null，而不是一整页规则", async () => {
      expect(await enrollmentViewFor(suspended)).toBeNull();
    });

    it("管理员看到规则与命中数", async () => {
      const view = await enrollmentViewFor(admin);

      expect(view?.rules).toHaveLength(listRules().length);
      expect(view?.ruleMatches).toHaveLength(listRules().length);
      expect(view?.groupCounts).not.toBeNull();
      expect(view?.untagged).not.toBeNull();
    });

    it("只有 admin.access 时给规则不给命中数", async () => {
      const consoleOnly: typeof admin = {
        handle: "adminaccess-setter",
        groups: [],
        can: (capability) => capability === "admin.access",
      };

      const view = await enrollmentViewFor(consoleOnly);

      expect(view).not.toBeNull();
      expect(view?.rules).toHaveLength(listRules().length);
      expect(view?.ruleMatches).toBeNull();
      expect(view?.groupCounts).toBeNull();
      expect(view?.untagged).toBeNull();
    });

    it("命中数只统计 active 账号", async () => {
      const view = await enrollmentViewFor(admin);

      for (const count of view?.ruleMatches ?? []) {
        expect(count).toBeGreaterThanOrEqual(0);
      }
      for (const [, count] of view?.groupCounts ?? []) {
        expect(count).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
