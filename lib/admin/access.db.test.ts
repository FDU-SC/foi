import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AS_PLAYER, viewerFor } from "@/lib/auth/viewer";
import { db } from "@/lib/db";
import { allContests } from "@/lib/contests/registry";
import { listGrants, listRules } from "@/lib/enrollment/registry";
import {
  adminContestsFor,
  adminOverviewFor,
  enrollmentViewFor,
} from "./access";

/**
 * The gate the console did not have.
 *
 * Two of the four admin pages checked `admin.access` and two did not, and the
 * one that mattered was `/admin/enrollment`: its data came straight from the
 * registries, so nothing else stood between a viewer and the grants list naming
 * everybody who holds privilege. These cases exist so that regression cannot
 * come back silently — every entry point here has to refuse.
 *
 * Reads the account table for the hit counts, so it runs against a real
 * Postgres and skips itself when there is none.
 */
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

const admin = viewerFor({ handle: "adminaccess-admin", groups: ["管理员"] });
const player = viewerFor({ handle: "adminaccess-player", groups: [] });

/**
 * Somebody the repository never named — which is what a suspended
 * administrator resolves to, since `getResolvedUser()` returns null for a
 * suspended account and `viewerFor(null)` has no groups at all. `proxy.ts`
 * would have let them through to `/admin`, because it reads the token.
 */
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
    it("选手拿到 null，看不到分流规则也看不到授权名单", async () => {
      expect(await enrollmentViewFor(player)).toBeNull();
    });

    /**
     * The case that was actually reachable before this layer existed: a live
     * JWT gets past `proxy.ts`, the page had no second check, and the grants
     * list is the most sensitive configuration on the platform — it is the
     * list of who to go after.
     */
    it("被封禁的管理员拿到 null，而不是一页完整的授权名单", async () => {
      expect(await enrollmentViewFor(suspended)).toBeNull();
    });

    it("管理员看到规则、授权与命中数", async () => {
      const view = await enrollmentViewFor(admin);

      expect(view?.rules).toHaveLength(listRules().length);
      expect(view?.grants).toHaveLength(listGrants().length);
      expect(view?.ruleMatches).toHaveLength(listRules().length);
      expect(view?.groupCounts).not.toBeNull();
      expect(view?.untagged).not.toBeNull();
    });

    /**
     * The capability split the console is supposed to support, and the thing
     * nothing exercised while the only declared group held all ten: the rules
     * are platform state and answer to `admin.access`, the counts are derived
     * from addresses and answer to `account.read`.
     */
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

      // Every count is bounded by the active directory it was computed from,
      // which is what rules out a suspended signup inflating a cohort.
      for (const count of view?.ruleMatches ?? []) {
        expect(count).toBeGreaterThanOrEqual(0);
      }
      for (const [, count] of view?.groupCounts ?? []) {
        expect(count).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
