import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PUT } from "@/app/api/judge/callback/route";
import {
  callbackUrl,
  createCallbackToken,
  resolveBackend,
} from "@/lib/backend/client";
import { signedHeaders } from "@/lib/backend/signature";
import type { SubmissionState } from "@/lib/backend/types";
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
 * The callback path reads two things out of the environment at call time: the
 * URL it signs against (`callbackUrl`) and the shared secret it signs with
 * (`resolveBackend`). Stubbed here rather than defaulted in the vitest config
 * because only this file needs them — and because a checked-in default named
 * `FOI_BACKEND_SECRET` is the wrong shape to leave lying around in a
 * repository whose first rule is that keys do not go in git.
 *
 * Stubbing also makes the run independent of whoever's `.env.local` is on
 * disk: the signature has to verify against these values and no others.
 */
const TEST_ENV = {
  FOI_PUBLIC_URL: "http://localhost:3000",
  FOI_BACKEND_SECRET: "callback-suite-signing-key",
} as const;

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
  options?: {
    tokenOverride?: string;
    skipInsert?: boolean;
    /** The row's state before the callback arrives. `judging` is the usual one. */
    state?: SubmissionState;
    error?: string;
    outcome?: string;
  },
): Promise<{ response: Response; token: string }> {
  const { token, hash } = createCallbackToken();

  if (!options?.skipInsert) {
    await db.insert(submissions).values({
      id,
      handle: HANDLE,
      problemSlug: slug,
      payload: {},
      backendId: "traditional",
      callbackTokenHash: hash,
      state: options?.state ?? "judging",
      error: options?.error ?? null,
      outcome: options?.outcome ?? null,
    });
  }

  const raw = JSON.stringify({
    submissionId: id,
    callbackToken: options?.tokenOverride ?? token,
    ...body,
  });
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

/** The same shape with the signature headers left off entirely. */
async function callbackUnsigned(
  id: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const raw = JSON.stringify({ submissionId: id, callbackToken: "tok", ...body });
  return PUT(
    new Request(callbackUrl(), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: raw,
    }),
  );
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

describeDb("评测回调落地", () => {
  beforeAll(async () => {
    for (const [key, value] of Object.entries(TEST_ENV)) {
      vi.stubEnv(key, value);
    }

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

  afterAll(async () => {
    await cleanup();
    vi.unstubAllEnvs();
  });

  it("完整回传时四列都是评测机说的", async () => {
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

  it("评测机版本落进列，作为溯源的后端那一半", async () => {
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

  /**
   * Existence is answered only to whoever holds a backend's secret: a judge
   * calling back about a row the kernel has lost deserves the plain 404, and
   * anyone else gets the same refusal whether or not the id is real.
   */
  it("不存在的提交：有效签名得到 404，无签名得到 401", async () => {
    const signed = await callback(
      "sub_cb_ghost",
      { backendVersion: VERSION, status: "accepted" },
      LIVE.slug,
      { skipInsert: true },
    );
    expect(signed.response.status).toBe(404);

    const unsigned = await callbackUnsigned("sub_cb_ghost", {
      backendVersion: VERSION,
      status: "accepted",
    });
    expect(unsigned.status).toBe(401);
  });

  it("存在的提交缺签名也是 401，且理由与提交不存在时逐字相同", async () => {
    await db.insert(submissions).values({
      id: "sub_cb_unsigned",
      handle: HANDLE,
      problemSlug: LIVE.slug,
      payload: {},
      backendId: "traditional",
      callbackTokenHash: "irrelevant",
      state: "judging",
    });

    const existing = await callbackUnsigned("sub_cb_unsigned", {
      backendVersion: VERSION,
      status: "accepted",
    });
    expect(existing.status).toBe(401);

    const missing = await callbackUnsigned("sub_cb_no_row", {
      backendVersion: VERSION,
      status: "accepted",
    });
    expect(missing.status).toBe(401);
    expect(await existing.json()).toEqual(await missing.json());

    // The refusal must not have written anything.
    const [row] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, "sub_cb_unsigned"));
    expect(row.state).toBe("judging");
  });

  /**
   * The pair that fixes what `abandoned` is for. Abandonment is the reconciler
   * concluding from silence that no verdict is coming, and this is the backend
   * proving it wrong — so the write must land, and the timeout text it lands
   * over must go with it. A single "terminal" predicate cannot express this:
   * the row is settled for every client and still writable for this caller.
   */
  it("对账放弃后到达的真结果仍然落地，并清掉超时文案", async () => {
    const { response } = await callback(
      "sub_cb_late",
      { backendVersion: VERSION, status: "accepted", score: 100 },
      LIVE.slug,
      { state: "abandoned", error: "评测超时，未收到题目后端结果" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const [row] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, "sub_cb_late"));
    expect(row.state).toBe("completed");
    expect(row.outcome).toBe("accepted");
    expect(row.error).toBeNull();
  });

  /**
   * The other half, and the reason the widening above is not simply "accept
   * everything": a verdict that already landed is the one that counts, and a
   * judge retrying a delivery it never saw acknowledged must not overwrite it.
   */
  it("已完成的提交再收到回调算重复投递，结果不被改写", async () => {
    const { response } = await callback(
      "sub_cb_dup",
      { backendVersion: VERSION, status: "wrong_answer", score: 0 },
      LIVE.slug,
      { state: "completed", outcome: "accepted" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ duplicate: true });

    const [row] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, "sub_cb_dup"));
    expect(row.state).toBe("completed");
    expect(row.outcome).toBe("accepted");
  });

  it("签名有效但回调令牌错误时被拒绝，提交不被改写", async () => {
    const { response } = await callback(
      "sub_cb_badtoken",
      { backendVersion: VERSION, status: "accepted", score: 100 },
      LIVE.slug,
      { tokenOverride: "not-the-issued-token" },
    );
    expect(response.status).toBe(401);

    const [row] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, "sub_cb_badtoken"));
    expect(row.state).toBe("judging");
    expect(row.verdict).toBeNull();
  });
});
