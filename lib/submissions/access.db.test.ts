import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AS_PLAYER } from "@/lib/auth/test-support";
import { viewerFor } from "@/lib/auth/viewer";
import { db } from "@/lib/db";
import { accounts, problems, submissions } from "@/lib/db/schema";
import { canReadSubmission, submissionFor, submissionsFor } from "./access";

/**
 * The submission gate needs rows, so this runs against a real Postgres and
 * skips itself when there is none.
 *
 * The case that matters most is the last one in "列表范围": it is the exact
 * shape of the bug this module exists to prevent — a player asking the list
 * endpoint for everything and getting it.
 */
const OWNER = "subaccess-owner";
const OTHER = "subaccess-other";
const SLUG = "subaccess-problem";

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
  console.warn("[test] 数据库不可达，跳过提交门禁集成用例");
}

const ownerViewer = viewerFor({ handle: OWNER, groups: [] });
const otherViewer = viewerFor({ handle: OTHER, groups: [] });
const adminViewer = viewerFor({ handle: "subaccess-admin", groups: ["管理员"] });

async function cleanup() {
  for (const handle of [OWNER, OTHER, "subaccess-admin"]) {
    await db.delete(submissions).where(eq(submissions.handle, handle));
    await db.delete(accounts).where(eq(accounts.handle, handle));
  }
  await db.delete(problems).where(eq(problems.slug, SLUG));
}

describeDb("提交门禁", () => {
  beforeAll(async () => {
    await cleanup();
    await db.insert(problems).values({ slug: SLUG, title: "Access Fixture" });
    for (const handle of [OWNER, OTHER, "subaccess-admin"]) {
      await db.insert(accounts).values({
        handle,
        displayName: handle,
        source: "registration",
      });
    }
    await db.insert(submissions).values([
      {
        id: "sub_access_owner",
        handle: OWNER,
        problemSlug: SLUG,
        payload: {},
        backendId: "traditional",
        maxScore: 100,
        state: "completed",
      },
      {
        id: "sub_access_other",
        handle: OTHER,
        problemSlug: SLUG,
        payload: {},
        backendId: "traditional",
        maxScore: 100,
        state: "completed",
      },
    ]);
  });

  afterAll(cleanup);

  describe("canReadSubmission", () => {
    it("本人可读", async () => {
      const row = await submissionFor("sub_access_owner", ownerViewer);
      expect(row).toBeDefined();
      if (row) expect(canReadSubmission(row, ownerViewer)).toBe(true);
    });
  });

  describe("submissionFor", () => {
    it("他人的提交返回 undefined，与不存在无法区分", async () => {
      await expect(
        submissionFor("sub_access_other", ownerViewer),
      ).resolves.toBeUndefined();
      await expect(
        submissionFor("sub_does_not_exist", ownerViewer),
      ).resolves.toBeUndefined();
    });

    it("持有 submission.readAny 的人可读他人提交", async () => {
      await expect(
        submissionFor("sub_access_other", adminViewer),
      ).resolves.toBeDefined();
    });

    it("匿名视角读不到任何提交", async () => {
      await expect(
        submissionFor("sub_access_owner", AS_PLAYER),
      ).resolves.toBeUndefined();
    });
  });

  describe("列表范围", () => {
    it("选手只拿到自己的", async () => {
      const rows = await submissionsFor(ownerViewer, { problemSlug: SLUG });
      expect(rows.map((r) => r.handle)).toEqual([OWNER]);
    });

    it("持有 readAny 的人拿到全部", async () => {
      const rows = await submissionsFor(adminViewer, { problemSlug: SLUG });
      expect(rows.map((r) => r.handle).sort()).toEqual([OTHER, OWNER]);
    });

    it("readAny 可以按 handle 收窄", async () => {
      const rows = await submissionsFor(adminViewer, {
        problemSlug: SLUG,
        handle: OTHER,
      });
      expect(rows.map((r) => r.handle)).toEqual([OTHER]);
    });

    it("选手点名他人的 handle 不会放宽，仍然只拿到自己的", async () => {
      const rows = await submissionsFor(ownerViewer, {
        problemSlug: SLUG,
        handle: OTHER,
      });
      expect(rows.map((r) => r.handle)).toEqual([OWNER]);
    });

    it("不给任何过滤条件时，选手拿到的仍然只有自己的", async () => {
      // The original leak: the list endpoint answered for the whole site when
      // no scoping argument was supplied. Scope now comes from the viewer, so
      // there is no argument to omit.
      const rows = await submissionsFor(otherViewer);
      expect(rows.every((r) => r.handle === OTHER)).toBe(true);
    });

    it("匿名视角拿不到任何提交", async () => {
      const rows = await submissionsFor(AS_PLAYER, { problemSlug: SLUG });
      expect(rows).toEqual([]);
    });
  });
});
