import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUT } from "@/app/api/judge/callback/route";
import {
  callbackUrl,
  createCallbackToken,
  resolveBackend,
} from "@/lib/backend/client";
import { signedHeaders } from "@/lib/backend/signature";
import { db } from "@/lib/db";
import { accounts, problems, submissions } from "@/lib/db/schema";
import { allProblems } from "@/lib/problems/registry";

/**
 * What a backend says, and what the kernel keeps.
 *
 * The callback is the one place a verdict is read: everything downstream —
 * standings, submission lists, the badge — works from the columns this writes.
 * So the cases here are the shapes a reply can take, including the ones that
 * leave most of it out.
 */
const HANDLE = "cb-alice";

/**
 * A slug the repository no longer has, which is a state the mirror table is
 * designed to hold: a problem can be deleted while its submissions remain.
 */
const ORPHAN = "cb-fixture";

/** A real one, so the fallback to a configured total has something to fall to. */
const LIVE = allProblems()[0]!;

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

async function cleanup(): Promise<void> {
  await db.delete(submissions).where(eq(submissions.handle, HANDLE));
  await db.delete(accounts).where(eq(accounts.handle, HANDLE));
  await db.delete(problems).where(eq(problems.slug, ORPHAN));
}

const VERSION = "mock/1.2.3";

/**
 * Posts a callback the way a backend would: a real signed request through the
 * route handler, not a direct write. The signature and the one-time token are
 * the reason this endpoint is safe, so a test that skipped them would be
 * testing a different function.
 *
 * Returns the response so the rejection cases can inspect it; `land` below is
 * the happy path that most cases want.
 */
async function callback(
  id: string,
  body: Record<string, unknown>,
  slug: string = LIVE.slug,
): Promise<{ response: Response; token: string }> {
  const { token, hash } = createCallbackToken();

  await db.insert(submissions).values({
    id,
    handle: HANDLE,
    problemSlug: slug,
    payload: {},
    backendId: "traditional",
    callbackTokenHash: hash,
    state: "judging",
  });

  const raw = JSON.stringify({ submissionId: id, callbackToken: token, ...body });
  const url = new URL(callbackUrl());

  const response = await PUT(
    new Request(url, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...signedHeaders(resolveBackend("traditional").secret, {
          method: "PUT",
          path: url.pathname,
          body: raw,
        }),
      },
      body: raw,
    }),
  );

  return { response, token };
}

async function land(
  id: string,
  verdict: Record<string, unknown>,
  slug: string = LIVE.slug,
): Promise<typeof submissions.$inferSelect> {
  const { response } = await callback(
    id,
    { backendVersion: VERSION, ...verdict },
    slug,
  );
  expect(response.status).toBe(200);

  const [row] = await db.select().from(submissions).where(eq(submissions.id, id));
  return row;
}

describeDb("判题回调落地", () => {
  beforeAll(async () => {
    await cleanup();
    await db
      .insert(problems)
      .values([
        { slug: ORPHAN, title: "Deleted Problem" },
        { slug: LIVE.slug, title: LIVE.title },
      ])
      .onConflictDoNothing();
    await db
      .insert(accounts)
      .values({ handle: HANDLE, displayName: HANDLE, source: "registration" });
  });

  afterAll(cleanup);

  it("完整回传时四列都是判题机说的", async () => {
    const row = await land("sub_cb_full", {
      status: "accepted",
      score: 100,
      maxScore: 100,
    });

    expect(row.state).toBe("completed");
    expect(row.outcome).toBe("accepted");
    expect(row.score).toBe(100);
    expect(row.maxScore).toBe(100);
    expect(row.accepted).toBeNull();
  });

  it("判题机版本落进列，作为溯源的后端那一半", async () => {
    const row = await land("sub_cb_version", { status: "accepted", score: 1 });

    expect(row.backendVersion).toBe(VERSION);
  });

  /**
   * The one field every existing backend is missing the first time it meets a
   * kernel that requires it. A generic "格式不合法" would send an operator to
   * inspect a body that is otherwise correct, which is the mistake the
   * signature check already learned to avoid.
   */
  it("不报版本的回调被拒绝，且错误点名这个字段", async () => {
    const { response } = await callback("sub_cb_noversion", {
      status: "accepted",
      score: 100,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("backendVersion"),
    });

    const [row] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, "sub_cb_noversion"));
    expect(row.state).toBe("judging");
  });

  /**
   * The fallback that lets a backend stay silent about a total it has no
   * opinion on. Resolved here rather than at read time so that editing the
   * problem afterwards cannot rescore what has already been judged.
   */
  it("不报 maxScore 时落到题目配置的满分", async () => {
    const row = await land("sub_cb_nomax", { status: "accepted", score: 80 });

    expect(row.maxScore).toBe(LIVE.maxScore);
    expect(row.score).toBe(80);
  });

  /**
   * Reachable through the reconciler: a submission outlives the problem it was
   * made against. Inventing a denominator here would silently rescore it.
   */
  it("题目已从仓库删除时 maxScore 留空，而不是编一个", async () => {
    const row = await land(
      "sub_cb_orphan",
      { status: "accepted", score: 80 },
      ORPHAN,
    );

    expect(row.maxScore).toBeNull();
    expect(row.score).toBe(80);
  });

  it("声明 accepted 时原样记下，哪怕分数不满", async () => {
    const row = await land("sub_cb_declared", {
      status: "slow_but_correct",
      score: 40,
      maxScore: 100,
      accepted: true,
    });

    expect(row.accepted).toBe(true);
    expect(row.outcome).toBe("slow_but_correct");
  });

  it("只报 status 时其余为空，而不是被编出一个零分", async () => {
    const row = await land("sub_cb_bare", { status: "checked" });

    expect(row.outcome).toBe("checked");
    expect(row.score).toBeNull();
    expect(row.accepted).toBeNull();
  });

  it("verdict 原样存档，题目组件仍能读到自己的 detail", async () => {
    const detail = { tests: [{ name: "t1", status: "accepted" }] };
    const row = await land("sub_cb_detail", {
      status: "accepted",
      score: 1,
      detail,
    });

    expect(row.verdict).toMatchObject({ status: "accepted", detail });
  });
});
