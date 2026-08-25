import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/runner/jobs/[id]/route";
import { resolveBackend } from "@/lib/backend/client";
import { signedHeaders } from "@/lib/backend/signature";
import { db } from "@/lib/db";
import { accounts, problems, submissions } from "@/lib/db/schema";
import { externallyJudged } from "@/lib/problems/registry";
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
 * `backends.config.ts` knows. Nothing here claims, so an unrelated row in the
 * same queue cannot interfere.
 */
const BACKEND = "traditional";

const PROBLEM =
  externallyJudged().find((problem) => problem.backend.id === BACKEND) ??
  externallyJudged()[0]!;

const PAYLOAD = { language: "cpp", source: "int main() { return 0; }" };

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
 * A request shaped exactly as a runner's is: the lease in the query string,
 * because the signature covers the path and its search and no headers at all,
 * and a GET has no body to put it in.
 */
function fetchJob(
  id: string,
  options: { lease?: string; signed?: boolean } = {},
): Promise<Response> {
  const search =
    options.lease === undefined
      ? ""
      : `?lease=${encodeURIComponent(options.lease)}`;
  const path = jobPath(id) + search;

  return GET(
    new Request(`http://localhost:3000${path}`, {
      method: "GET",
      headers:
        options.signed === false
          ? {}
          : signedHeaders(resolveBackend(BACKEND).secret, {
              method: "GET",
              path,
              body: "",
            }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function cleanup(): Promise<void> {
  await db.delete(submissions).where(eq(submissions.handle, HANDLE));
  await db.delete(accounts).where(eq(accounts.handle, HANDLE));
}

describeDb("取提交详情", () => {
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
      signed: false,
    });

    expect(response.status).toBe(401);
    expect(await response.json()).not.toHaveProperty("payload");
  });
});
