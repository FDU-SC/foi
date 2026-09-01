import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AS_PLAYER } from "@/test/auth-support";
import { viewerFor } from "@/lib/authz/viewer";
import { db } from "@/lib/db";
import { accounts, contests, problems, submissions } from "@/lib/db/schema";
import { submissionFor, submissionsFor } from "./access";
import { viewerWith } from "@/test/content-shapes";

const SLUG = "subaccess-problem";

let OWNER_UID = 0;
let OTHER_UID = 0;
let ADMIN_UID = 0;

async function reachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

const online = await reachable();
const CONTEST = "subaccess-round";

const describeDb = online ? describe : describe.skip;

if (!online) {
  console.warn("[test] 数据库不可达，跳过提交门禁集成用例");
}

async function cleanup() {
  for (const uid of [OWNER_UID, OTHER_UID, ADMIN_UID]) {
    if (uid) {
      await db.delete(submissions).where(eq(submissions.uid, uid));
      await db.delete(accounts).where(eq(accounts.uid, uid));
    }
  }
  await db.delete(problems).where(eq(problems.slug, SLUG));
  await db.delete(contests).where(eq(contests.slug, CONTEST));
}

describeDb("提交门禁", () => {
  let ownerViewer: ReturnType<typeof viewerFor>;
  let otherViewer: ReturnType<typeof viewerFor>;
  let adminViewer: ReturnType<typeof viewerFor>;

  beforeAll(async () => {
    await cleanup();
    await db.insert(problems).values({ slug: SLUG, title: "Access Fixture" });
    await db.insert(contests).values({ slug: CONTEST, title: "Access Fixture" });

    const [owner] = await db
      .insert(accounts)
      .values({ username: "subaccess-owner", nickname: "subaccess-owner" })
      .returning({ uid: accounts.uid });
    OWNER_UID = owner.uid;

    const [other] = await db
      .insert(accounts)
      .values({ username: "subaccess-other", nickname: "subaccess-other" })
      .returning({ uid: accounts.uid });
    OTHER_UID = other.uid;

    const [admin] = await db
      .insert(accounts)
      .values({ username: "subaccess-admin", nickname: "subaccess-admin" })
      .returning({ uid: accounts.uid });
    ADMIN_UID = admin.uid;

    ownerViewer = viewerFor({ uid: OWNER_UID, groups: [] });
    otherViewer = viewerFor({ uid: OTHER_UID, groups: [] });
    adminViewer = viewerWith("submission.read");

    await db.insert(submissions).values([
      {
        id: "sub_access_owner",
        uid: OWNER_UID,
        problemSlug: SLUG,
        contestSlug: CONTEST,
        payload: {},
        backendId: "queue-a",
        state: "completed",
      },
      {
        id: "sub_access_other",
        uid: OTHER_UID,
        problemSlug: SLUG,
        contestSlug: CONTEST,
        payload: {},
        backendId: "queue-a",
        state: "completed",
      },
    ]);
  });

  afterAll(cleanup);

  describe("submissionFor", () => {
    it("本人可读", async () => {
      await expect(
        submissionFor("sub_access_owner", ownerViewer),
      ).resolves.toBeDefined();
    });

    it("他人的提交返回 undefined，与不存在无法区分", async () => {
      await expect(
        submissionFor("sub_access_other", ownerViewer),
      ).resolves.toBeUndefined();
      await expect(
        submissionFor("sub_does_not_exist", ownerViewer),
      ).resolves.toBeUndefined();
    });

    it("被放行 submission.read 的人可读他人提交", async () => {
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
      expect(rows.map((r) => r.uid)).toEqual([OWNER_UID]);
    });

    it("持有 readAny 的人拿到全部", async () => {
      const rows = await submissionsFor(adminViewer, { problemSlug: SLUG });
      expect(rows.map((r) => r.uid).sort()).toEqual(
        [OTHER_UID, OWNER_UID].sort(),
      );
    });

    it("readAny 可以按 uid 收窄", async () => {
      const rows = await submissionsFor(adminViewer, {
        problemSlug: SLUG,
        uid: OTHER_UID,
      });
      expect(rows.map((r) => r.uid)).toEqual([OTHER_UID]);
    });

    it("选手点名他人的 uid 拿到空，而不是被悄悄换成自己的", async () => {
      const rows = await submissionsFor(ownerViewer, {
        problemSlug: SLUG,
        uid: OTHER_UID,
      });
      expect(rows).toEqual([]);
    });

    it("不给任何过滤条件时，选手拿到的仍然只有自己的", async () => {

      const rows = await submissionsFor(otherViewer);
      expect(rows.every((r) => r.uid === OTHER_UID)).toBe(true);
    });

    it("匿名视角拿不到任何提交", async () => {
      const rows = await submissionsFor(AS_PLAYER, { problemSlug: SLUG });
      expect(rows).toEqual([]);
    });
  });
});
