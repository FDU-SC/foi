import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "@/app/api/runner/jobs/[id]/route";
import { resolveBackend } from "@/lib/backend/client";
import {
  MAX_CLOCK_SKEW_SECONDS,
  sign,
  signedHeaders,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  type SignedRequest,
} from "@/lib/backend/signature";
import type { Verdict } from "@/lib/backend/types";
import { db } from "@/lib/db";
import { accounts, problems, submissions } from "@/lib/db/schema";
import { externalProblem } from "@/test/content-shapes";
import { jobPath } from "./auth";

/**
 * Who may read a submission's contents, asked at the endpoint rather than one
 * layer down.
 *
 * `jobDetails` is covered in `queue.db.test.ts`, and that is where the holder
 * rule lives — but the rule is only worth anything if the route reaches for it
 * with the lease the caller actually sent. The two failures this catches are
 * both wiring: a handler that verifies the signature and then serves the row,
 * and a lease read from somewhere the signature does not cover. Neither is
 * visible from inside the queue module.
 *
 * The threat is a runner that holds a real key. That is the whole population of
 * callers here — there is no session — so a correct signature is the starting
 * point of every case below rather than the thing being tested.
 */
const HANDLE = "runner-route-alice";

/**
 * A real backend, unlike the fixture queues the other two suites use: the
 * signature is verified against `resolveBackend`, so the id has to be one
 * `content/backends.ts` knows. Taken off a problem rather than named, which
 * gets both facts from one place — the id resolves *and* something routes to
 * it. Nothing here claims, so an unrelated row in the same queue cannot
 * interfere.
 */
const PROBLEM = externalProblem();
const BACKEND = PROBLEM.backend.id;

const PAYLOAD = { language: "cpp", source: "int main() { return 0; }" };

const VERDICT: Verdict = { status: "accepted", score: 100, maxScore: 100 };
const VERSION = "runner-route-fixture/1.0.0";

/**
 * An id no row ever has. The 401 contract below is entirely about telling this
 * apart from a real one, so nothing may insert it.
 */
const MISSING = "sub_jr_no_such_row";

/**
 * Stubbed rather than read from whoever's `.env.local` is on disk: the
 * signatures below have to verify against this value and no other.
 */
const SECRET = "runner-route-suite-signing-key";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

/**
 * A job in flight, with a lease chosen by the test.
 *
 * Written directly instead of claimed, because a claim would take the oldest
 * row on a real backend's queue — which in a development database may be
 * somebody's actual submission.
 */
async function holding(id: string, lease: string): Promise<string> {
  await db.insert(submissions).values({
    id,
    handle: HANDLE,
    problemSlug: PROBLEM.slug,
    payload: PAYLOAD,
    backendId: BACKEND,
    state: "judging",
    lease,
    runnerId: "r-route",
    claimedAt: new Date(),
    lastHeartbeatAt: new Date(),
    attempts: 1,
  });
  return id;
}

/**
 * What a caller can put in the two signature headers.
 *
 * The three that are not `valid` are the population the 401 contract is about:
 * none of them demonstrates possession of any configured key, so none of them
 * may be able to tell an id that exists from one that does not. They are
 * distinct cases rather than one because they fail at three different points
 * of `verifySignature` — before the headers are read, on the clock, and on the
 * HMAC — and it was the first two that used to leak.
 */
type Credential = "valid" | "none" | "stale" | "wrong-key";

function credentials(
  kind: Credential,
  signed: SignedRequest,
): Record<string, string> {
  const secret = resolveBackend(BACKEND).secret;

  switch (kind) {
    // The content type is held constant on purpose: the signature headers are
    // the variable under test, and `guardRequest` reads this one.
    case "none":
      return { "content-type": "application/json" };
    case "wrong-key":
      return signedHeaders(`${secret}-forged`, signed);
    case "stale": {
      // Correctly signed, for a timestamp outside the skew window. Worth its
      // own case because `verifySignature` refuses on the clock before it
      // compares an HMAC — so this caller has proved nothing either, however
      // right the rest of it looks.
      const timestamp =
        Math.floor(Date.now() / 1000) - MAX_CLOCK_SKEW_SECONDS - 60;
      return {
        "content-type": "application/json",
        [TIMESTAMP_HEADER]: String(timestamp),
        [SIGNATURE_HEADER]: sign(secret, timestamp, signed),
      };
    }
    case "valid":
      return signedHeaders(secret, signed);
  }
}

/**
 * A request shaped exactly as a runner's is: the lease in the query string,
 * because the signature covers the path and its search and no headers at all,
 * and a GET has no body to put it in.
 */
function fetchJob(
  id: string,
  options: { lease?: string; credential?: Credential } = {},
): Promise<Response> {
  const search =
    options.lease === undefined
      ? ""
      : `?lease=${encodeURIComponent(options.lease)}`;
  const path = jobPath(id) + search;
  const signed = { method: "GET", path, body: "" };

  return GET(
    new Request(`http://localhost:3000${path}`, {
      method: "GET",
      headers: credentials(options.credential ?? "valid", signed),
    }),
    { params: Promise.resolve({ id }) },
  );
}

/** The other half of the protocol: what a holder says about a job it holds. */
function report(
  id: string,
  body: unknown,
  options: { credential?: Credential } = {},
): Promise<Response> {
  const path = jobPath(id);
  const text = JSON.stringify(body);
  const signed = { method: "PUT", path, body: text };

  return PUT(
    new Request(`http://localhost:3000${path}`, {
      method: "PUT",
      headers: credentials(options.credential ?? "valid", signed),
      body: text,
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function rowOf(id: string): Promise<typeof submissions.$inferSelect> {
  const [row] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, id));
  return row;
}

async function cleanup(): Promise<void> {
  await db.delete(submissions).where(eq(submissions.handle, HANDLE));
  await db.delete(accounts).where(eq(accounts.handle, HANDLE));
}

describeDb("评测机作业接口", () => {
  beforeAll(async () => {
    vi.stubEnv("FOI_BACKEND_SECRET", SECRET);
    vi.stubEnv("FOI_PUBLIC_URL", "http://localhost:3000");

    await cleanup();
    await db
      .insert(problems)
      .values({ slug: PROBLEM.slug, title: PROBLEM.title })
      .onConflictDoNothing();
    await db
      .insert(accounts)
      .values({ handle: HANDLE, displayName: HANDLE, source: "registration" });

    await holding("sub_jr_mine", "lease-held-by-me");
    await holding("sub_jr_theirs", "lease-held-by-somebody-else");
  });

  afterAll(async () => {
    await cleanup();
    vi.unstubAllEnvs();
  });

  it("当前持有者取得到提交内容", async () => {
    const response = await fetchJob("sub_jr_mine", {
      lease: "lease-held-by-me",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "sub_jr_mine",
      payload: PAYLOAD,
      problem: { slug: PROBLEM.slug },
      user: { handle: HANDLE },
    });
  });

  /**
   * The enumeration the endpoint exists to prevent, and the reason the details
   * are not simply attached to the claim: submission ids are time-ordered
   * ULIDs, so one compromised evaluator with a valid key and one legitimate
   * lease could otherwise walk the space and read every competitor's source.
   */
  it("拿自己的 lease 去要别人那一条，只拿到 409，内容一个字都不给", async () => {
    const response = await fetchJob("sub_jr_theirs", {
      lease: "lease-held-by-me",
    });

    // 409 rather than 404, and a runner acts on the difference: the job exists,
    // it is simply not yours any more — stop evaluating it.
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("payload");
  });

  it("不带 lease 的请求同样拿不到内容", async () => {
    const response = await fetchJob("sub_jr_mine");

    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("payload");
  });

  /**
   * The layer beneath, kept here so the two cannot be confused for one: holding
   * a key gets you as far as being asked which row you hold. Without one there
   * is no question to answer, and the refusal must not depend on whether the id
   * was real.
   */
  it("没有签名连自己那一条都读不到", async () => {
    const response = await fetchJob("sub_jr_mine", {
      lease: "lease-held-by-me",
      credential: "none",
    });

    expect(response.status).toBe(401);
    expect(await response.json()).not.toHaveProperty("payload");
  });

  /**
   * The existence oracle, and the reason both endpoints route their refusals
   * through one helper.
   *
   * Neither can verify anything until it has looked the row up — the key a
   * signature is checked against belongs to the backend the *row* names — so
   * "there is no such submission" was decided in one place and "your signature
   * is wrong" in another, and the two disagreed. An unsigned request for an id
   * that existed came back `缺少签名头`; the same request for one that did not
   * came back `签名不匹配`. Submission ids are time-ordered ULIDs, so that is
   * an unauthenticated enumeration of who submitted when.
   *
   * Asserted as an equality between two responses rather than as two expected
   * strings, because the property is that the caller cannot tell them apart —
   * not that either says anything in particular. Two hard-coded expectations
   * would go on passing after somebody reworded one branch.
   */
  describe("没证明持有密钥时，存在与不存在的 id 无从区分", () => {
    const unproven: Credential[] = ["none", "stale", "wrong-key"];

    it.each(unproven)("取详情：%s", async (credential) => {
      const [real, fake] = await Promise.all([
        fetchJob("sub_jr_mine", { lease: "lease-held-by-me", credential }),
        fetchJob(MISSING, { lease: "lease-held-by-me", credential }),
      ]);

      expect(real.status).toBe(401);
      expect(fake.status).toBe(real.status);
      expect(await fake.text()).toBe(await real.text());
    });

    it.each(unproven)("上报：%s", async (credential) => {
      const body = { lease: "lease-held-by-me", state: "alive" };
      const [real, fake] = await Promise.all([
        report("sub_jr_mine", body, { credential }),
        report(MISSING, body, { credential }),
      ]);

      expect(real.status).toBe(401);
      expect(fake.status).toBe(real.status);
      expect(await fake.text()).toBe(await real.text());
    });
  });

  /**
   * The other side of it: holding a key buys the plain answer, because a
   * runner asking about a job this deployment has no row for is an environment
   * mismatch worth diagnosing rather than an attempt to probe anything.
   */
  describe("签得过时，不存在的 id 才得到 404", () => {
    it("取详情", async () => {
      const response = await fetchJob(MISSING, { lease: "anything" });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "提交不存在" });
    });

    it("上报", async () => {
      const response = await report(MISSING, {
        lease: "anything",
        state: "alive",
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "提交不存在" });
    });
  });

  /**
   * The reporting half of the protocol, end to end at the endpoint.
   *
   * `reportAlive` / `reportDone` / `reportFailed` are covered in
   * `queue.db.test.ts`; what is only visible from here is the wiring — that
   * the discriminated union is parsed into the right call, that the lease the
   * caller sent is the one the guard is given, and that a refusal comes back
   * as 409 rather than as a 5xx a runner would retry against for ever.
   */
  describe("上报评测进展", () => {
    beforeAll(async () => {
      await holding("sub_jr_alive", "lease-alive");
      await holding("sub_jr_done", "lease-done");
      await holding("sub_jr_failed", "lease-failed");
      await holding("sub_jr_stale", "lease-current");
    });

    it("alive 记下进度，行仍然在评测中", async () => {
      const response = await report("sub_jr_alive", {
        lease: "lease-alive",
        state: "alive",
        status: "测试点 3/10",
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });

      const row = await rowOf("sub_jr_alive");
      expect(row.state).toBe("judging");
      expect(row.runnerStatus).toBe("测试点 3/10");
      expect(row.lease).toBe("lease-alive");
    });

    it("done 落定判定，并把 lease 交回去", async () => {
      const response = await report("sub_jr_done", {
        lease: "lease-done",
        state: "done",
        verdict: VERDICT,
        backendVersion: VERSION,
      });

      expect(response.status).toBe(200);

      const row = await rowOf("sub_jr_done");
      expect(row.state).toBe("completed");
      expect(row.verdict).toEqual(VERDICT);
      expect(row.backendVersion).toBe(VERSION);
      expect(row.judgedAt).not.toBeNull();
      // Nulled here is what makes a duplicate delivery fall out at the `where`
      // clause instead of rewriting a settled row.
      expect(row.lease).toBeNull();
    });

    it("failed 落 disrupted，理由原样留在行上", async () => {
      const response = await report("sub_jr_failed", {
        lease: "lease-failed",
        state: "failed",
        reason: "沙箱起不来",
        backendVersion: VERSION,
      });

      expect(response.status).toBe(200);

      const row = await rowOf("sub_jr_failed");
      expect(row.state).toBe("disrupted");
      expect(row.error).toBe("沙箱起不来");
      expect(row.verdict).toBeNull();
      expect(row.lease).toBeNull();
    });

    /**
     * 409 rather than 404 or a 5xx, and a runner acts on the difference: the
     * job exists, it is simply not yours any more — drop it. A 5xx invites the
     * retry loop the lease exists to cut.
     */
    it("拿作废的 lease 上报，什么都写不进去", async () => {
      const response = await report("sub_jr_stale", {
        lease: "lease-that-was-revoked",
        state: "done",
        verdict: VERDICT,
        backendVersion: VERSION,
      });

      expect(response.status).toBe(409);

      const row = await rowOf("sub_jr_stale");
      expect(row.state).toBe("judging");
      expect(row.lease).toBe("lease-current");
      expect(row.verdict).toBeNull();
    });

    it("上报格式不合法时，签名对也一样被拒", async () => {
      const response = await report("sub_jr_stale", {
        lease: "lease-current",
        state: "finished",
      });

      expect(response.status).toBe(400);
    });
  });
});
