import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/submissions/route";
import { AS_PLAYER } from "@/lib/auth/viewer";
import { db } from "@/lib/db";
import { accounts, submissions } from "@/lib/db/schema";
import { problemsFor } from "@/lib/problems/access";
import { DEFAULT_SUBMIT_RATE_LIMIT } from "@/lib/problems/types";

/**
 * The submission endpoint's throttle, exercised through the route handler
 * rather than against `rateLimit` alone: every accepted POST is a database
 * row plus an immediate dispatch, so the limit is what stands between one
 * account — stolen or malicious — and pressure on the judges. A regression
 * that drops the call would otherwise read as a one-line deletion.
 *
 * Which number applies is decided by `submitRateLimit`, covered on its own in
 * `lib/problems/submit-rate-limit.test.ts`. What matters here is that the
 * route reaches for it, and that the counter is keyed narrowly enough for a
 * per-problem limit to mean anything.
 */

const HANDLE = "rl-alice";

/**
 * Two real problems that are open to somebody in no group, so the gate and
 * the mirror upsert both run. Chosen through the access layer rather than by
 * index, so a problem that later gains an audience cannot silently turn this
 * into a test of the 404 path.
 */
const [FIRST, SECOND] = problemsFor(AS_PLAYER).map((view) => view.config);

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

// The route asks `@/auth` who is calling; everything else — the registry,
// the database, the backend client — runs for real.
vi.mock("@/auth", () => ({
  getResolvedUser: async () => ({
    handle: "rl-alice",
    displayName: "rl-alice",
    email: null,
    emailVerified: false,
    groups: [],
    status: "active",
    disabled: false,
  }),
  getSessionUser: async () => ({
    handle: "rl-alice",
    displayName: "rl-alice",
    groups: [],
  }),
}));

const TEST_ENV = {
  FOI_PUBLIC_URL: "http://localhost:3000",
  FOI_BACKEND_SECRET: "submit-route-suite-signing-key",
} as const;

/**
 * Dispatching really would call the judge over HTTP. The throttle question
 * is how many times the route gets that far, so the answer is stubbed to an
 * instant acknowledgement.
 */
const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ accepted: true, judgeRef: "ref" }),
  text: async () => "",
}));

function postSubmission(slug: string): Promise<Response> {
  return POST(
    new Request("http://localhost:3000/api/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        problemSlug: slug,
        payload: { language: "cpp", source: "int main() { return 0; }" },
      }),
    }),
  );
}

describeDb("提交端点限流", () => {
  beforeAll(async () => {
    for (const [key, value] of Object.entries(TEST_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubGlobal("fetch", fetchMock);

    await db.delete(submissions).where(eq(submissions.handle, HANDLE));
    await db.delete(accounts).where(eq(accounts.handle, HANDLE));
    await db
      .insert(accounts)
      .values({ handle: HANDLE, displayName: HANDLE, source: "registration" });
  });

  afterAll(async () => {
    await db.delete(submissions).where(eq(submissions.handle, HANDLE));
    await db.delete(accounts).where(eq(accounts.handle, HANDLE));
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("窗口内的提交照常落地，超出上限的得到 429 且不再投递", async () => {
    const allowed = DEFAULT_SUBMIT_RATE_LIMIT.max;

    for (let i = 0; i < allowed; i += 1) {
      const response = await postSubmission(FIRST.slug);
      expect(response.status).toBe(201);
    }

    const rejected = await postSubmission(FIRST.slug);
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).not.toBeNull();

    // The over-limit request must not have reached the judge.
    expect(fetchMock.mock.calls.length).toBe(allowed);

    const rows = await db
      .select()
      .from(submissions)
      .where(eq(submissions.handle, HANDLE));
    expect(rows.length).toBe(allowed);
  });

  /**
   * The counter is keyed by problem, which it has to be: a limit a problem
   * declares about itself cannot be enforced by a budget shared with every
   * other problem. Spending one problem's window must therefore leave the
   * next one untouched — the floor in `FLOOD_CAP` is what bounds the total.
   */
  it("一道题用光配额不影响另一道题", async () => {
    expect(SECOND.slug).not.toBe(FIRST.slug);

    const response = await postSubmission(SECOND.slug);
    expect(response.status).toBe(201);
  });
});
