import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/submissions/route";
import { db } from "@/lib/db";
import { accounts, submissions } from "@/lib/db/schema";
import { allProblems } from "@/lib/problems/registry";

/**
 * The submission endpoint's throttle, exercised through the route handler
 * rather than against `rateLimit` alone: every accepted POST is a database
 * row plus an immediate dispatch, so the limit is what stands between one
 * account — stolen or malicious — and pressure on the judges. A regression
 * that drops the call would otherwise read as a one-line deletion.
 */

const HANDLE = "rl-alice";

/** A real problem from the registry, so the gate and the mirror upsert run. */
const LIVE = allProblems()[0]!;

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

function postSubmission(): Promise<Response> {
  return POST(
    new Request("http://localhost:3000/api/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        problemSlug: LIVE.slug,
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
    for (let i = 0; i < 20; i += 1) {
      const response = await postSubmission();
      expect(response.status).toBe(201);
    }

    const rejected = await postSubmission();
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).not.toBeNull();

    // The over-limit request must not have reached the judge.
    expect(fetchMock.mock.calls.length).toBe(20);

    const rows = await db
      .select()
      .from(submissions)
      .where(eq(submissions.handle, HANDLE));
    expect(rows.length).toBe(20);
  });
});
