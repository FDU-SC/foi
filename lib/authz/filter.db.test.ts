import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AS_PLAYER } from "@/test/auth-support";
import { viewerWith } from "@/test/content-shapes";
import { accountRef } from "@/lib/accounts/resolve";
import { db } from "@/lib/db";
import {
  accountColumns,
  accounts,
  problems,
  submissions,
} from "@/lib/db/schema";
import { allows } from "./engine";
import { rowScope } from "./filter";
import { viewerFor, type Viewer } from "./viewer";

/**
 * A queryable action answers the same question twice: `when` about one row,
 * `filter` about the table. Nothing in the type system ties the two together,
 * so this compares the sets they produce over real rows.
 */

const SLUG = "authz-filter-fixture";

let OWNER_UID = 0;
let OTHER_UID = 0;

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
  console.warn("[test] 数据库不可达，跳过 when 与 filter 的一致性用例");
}

async function cleanup() {
  for (const uid of [OWNER_UID, OTHER_UID]) {
    if (!uid) continue;
    await db.delete(submissions).where(eq(submissions.uid, uid));
    await db.delete(accounts).where(eq(accounts.uid, uid));
  }
  await db.delete(problems).where(eq(problems.slug, SLUG));
}

/** Everything in the table, regardless of who is asking. */
async function allSubmissions() {
  return db.select().from(submissions);
}

async function scopedSubmissions(viewer: Viewer): Promise<string[]> {
  const scope = rowScope("submission.read", viewer);
  if (scope.kind === "none") return [];

  const rows = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(scope.kind === "where" ? scope.sql : undefined);

  return rows.map((row) => row.id).sort();
}

async function scopedAccounts(viewer: Viewer): Promise<number[]> {
  const scope = rowScope("account.read", viewer);
  if (scope.kind === "none") return [];

  const rows = await db
    .select({ uid: accounts.uid })
    .from(accounts)
    .where(scope.kind === "where" ? scope.sql : undefined);

  return rows.map((row) => row.uid).sort((a, b) => a - b);
}

describeDb("when 与 filter 选出同一批行", () => {
  const viewers: { what: string; viewer: () => Viewer }[] = [
    { what: "匿名", viewer: () => AS_PLAYER },
    { what: "本人", viewer: () => viewerFor({ uid: OWNER_UID, groups: [] }) },
    { what: "他人", viewer: () => viewerFor({ uid: OTHER_UID, groups: [] }) },
    { what: "能读全部提交的人", viewer: () => viewerWith("submission.read", 90) },
    { what: "能读账号目录的人", viewer: () => viewerWith("account.read", 91) },
  ];

  beforeAll(async () => {
    await cleanup();
    await db.insert(problems).values({ slug: SLUG, title: "Filter Fixture" });

    const [owner] = await db
      .insert(accounts)
      .values({ username: "authz-filter-owner", nickname: "owner" })
      .returning({ uid: accounts.uid });
    OWNER_UID = owner.uid;

    const [other] = await db
      .insert(accounts)
      .values({ username: "authz-filter-other", nickname: "other" })
      .returning({ uid: accounts.uid });
    OTHER_UID = other.uid;

    await db.insert(submissions).values(
      [OWNER_UID, OTHER_UID].map((uid) => ({
        id: `sub_authz_filter_${uid}`,
        uid,
        problemSlug: SLUG,
        payload: {},
        backendId: "queue-a",
        state: "completed" as const,
      })),
    );
  });

  afterAll(cleanup);

  it.each(viewers)("submission.read — $what", async ({ viewer }) => {
    const who = viewer();

    const byPredicate = (await allSubmissions())
      .filter((row) => allows("submission.read", row, who))
      .map((row) => row.id)
      .sort();

    expect(await scopedSubmissions(who)).toEqual(byPredicate);
  });

  it.each(viewers)("account.read — $what", async ({ viewer }) => {
    const who = viewer();

    const rows = await db.select(accountColumns).from(accounts);
    const byPredicate = rows
      .filter((row) => allows("account.read", accountRef(row), who))
      .map((row) => row.uid)
      .sort((a, b) => a - b);

    expect(await scopedAccounts(who)).toEqual(byPredicate);
  });

  it("固定装置里两个人各有一条提交，否则上面几条什么也没比", async () => {
    const rows = await allSubmissions();
    expect(rows.filter((row) => row.problemSlug === SLUG)).toHaveLength(2);
  });
});
