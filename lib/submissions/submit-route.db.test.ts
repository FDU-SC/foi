import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/submissions/route";
import { AS_PLAYER } from "@/lib/auth/test-support";
import { db } from "@/lib/db";
import { accounts, submissions } from "@/lib/db/schema";
import {
  INLINE_BACKEND_ID,
  INLINE_BACKEND_VERSION,
} from "@/lib/backend/types";
import { problemsFor } from "@/lib/problems/access";
import {
  DEFAULT_SUBMIT_RATE_LIMIT,
  isInlineBackend,
} from "@/lib/problems/types";

/**
 * The submission endpoint's throttle, exercised through the route handler
 * rather than against `rateLimit` alone: every accepted POST is a row a runner
 * will come and take, so the limit is what stands between one account — stolen
 * or malicious — and a queue nobody can drain. A regression that drops the call
 * would otherwise read as a one-line deletion.
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

/**
 * Whose request the route thinks it is handling.
 *
 * Mutable because the nonce index is scoped to the handle, and the only way to
 * hold it to that is to have two people submit under the same nonce. Every
 * suite but that one leaves it where it starts.
 */
let CALLER = HANDLE;

// The route asks `@/auth` who is calling; everything else — the registry,
// the database, the backend client — runs for real.
vi.mock("@/auth", () => ({
  getResolvedUser: async () => ({
    handle: CALLER,
    displayName: CALLER,
    email: null,
    emailVerified: false,
    groups: [],
    status: "active",
    disabled: false,
  }),
  getSessionUser: async () => ({
    handle: CALLER,
    displayName: CALLER,
    groups: [],
  }),
}));

const TEST_ENV = {
  FOI_PUBLIC_URL: "http://localhost:3000",
  FOI_BACKEND_SECRET: "submit-route-suite-signing-key",
} as const;

/**
 * Stubbed so that a route reaching for the network fails loudly rather than
 * trying to open a socket. Submitting is not supposed to call anybody at all
 * any more — the assertions below say so — but the stub is what makes the
 * difference between a red test and a hung suite if that changes.
 */
const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({}),
  text: async () => "",
}));

const PAYLOAD = { language: "cpp", source: "int main() { return 0; }" };

function post(body: Record<string, unknown>): Promise<Response> {
  return POST(
    new Request("http://localhost:3000/api/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function postSubmission(slug: string): Promise<Response> {
  return post({ problemSlug: slug, payload: PAYLOAD });
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

  it("窗口内的提交照常落地，超出上限的得到 429 且不留行", async () => {
    const allowed = DEFAULT_SUBMIT_RATE_LIMIT.max;

    for (let i = 0; i < allowed; i += 1) {
      const response = await postSubmission(FIRST.slug);
      expect(response.status).toBe(201);
    }

    const rejected = await postSubmission(FIRST.slug);
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).not.toBeNull();

    // Nothing here talks to a judge, over the limit or under it: the row is the
    // whole of what submitting does, and a runner picks it up on its own time.
    expect(fetchMock).not.toHaveBeenCalled();

    // Which makes the row count the only evidence the throttle worked.
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

/**
 * An inline problem's whole lifecycle happens inside one request: no queue to
 * wait in, no runner to claim it and nothing for the reaper to notice missing.
 * The row is created and settled before the response is written.
 */
describeDb("内联判题的提交", () => {
  const INLINE = problemsFor(AS_PLAYER)
    .map((view) => view.config)
    .find((config) => isInlineBackend(config.backend));

  beforeAll(async () => {
    for (const [key, value] of Object.entries(TEST_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("AUTH_SECRET", "inline-suite-key-0123456789abcdef");
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

  it("一次请求里判完，落库时已经是终态", async () => {
    expect(INLINE).toBeDefined();

    const response = await POST(
      new Request("http://localhost:3000/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          problemSlug: INLINE!.slug,
          payload: { text: "definitely not the answer" },
        }),
      }),
    );

    expect(response.status).toBe(201);

    const [row] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.handle, HANDLE));

    expect(row.state).toBe("completed");
    expect(row.outcome).not.toBeNull();
    // The sentinel, so nothing tries to resolve a backend for it — and so no
    // runner's claim can ever match the row.
    expect(row.backendId).toBe(INLINE_BACKEND_ID);
    expect(row.backendVersion).toBe(INLINE_BACKEND_VERSION);
  });

  it("完全不碰题目后端", async () => {
    const before = fetchMock.mock.calls.length;

    await POST(
      new Request("http://localhost:3000/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          problemSlug: INLINE!.slug,
          payload: { text: "still not the answer" },
        }),
      }),
    );

    expect(fetchMock.mock.calls.length).toBe(before);
  });
});

/**
 * The other thing an inline judge is allowed to say, and the reason the return
 * type is a union rather than a `Verdict`.
 *
 * `judge.test.ts` covers a judge deciding it cannot judge. What it cannot see
 * is where that lands, and landing is the entire point: a `system_error`
 * verdict — which is what these branches used to return — settles the row as
 * `completed`, which puts a platform misconfiguration on the scoreboard and,
 * under ACM rules, charges the competitor penalty minutes for it.
 *
 * `roulette-daily` by name rather than by predicate, because this needs a judge
 * whose refusal the suite can actually provoke, and its dependence on
 * `AUTH_SECRET` is the one thing here that can be taken away from the outside.
 */
describeDb("内联判题说自己判不了", () => {
  const ROULETTE = "roulette-daily";

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

  it("落 disrupted 带上原因，而不是一个零分的 completed", async () => {
    vi.stubEnv("AUTH_SECRET", "");

    const response = await POST(
      new Request("http://localhost:3000/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          problemSlug: ROULETTE,
          payload: { text: "red" },
        }),
      }),
    );

    expect(response.status).toBe(201);
    // Answered with the settled row rather than the queued one it was a moment
    // earlier: the insert and the settle are one transaction, and the reply is
    // written after it commits.
    expect((await response.json()).state).toBe("disrupted");

    const [row] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.handle, HANDLE));

    expect(row.state).toBe("disrupted");
    expect(row.error).toContain("AUTH_SECRET");
    // No result, and specifically not a zero — the same shape `reportFailed`
    // leaves on the runner path, because it is the same statement being made.
    expect(row.verdict).toBeNull();
    expect(row.outcome).toBeNull();
    expect(row.score).toBeNull();
    expect(row.accepted).toBeNull();
    expect(row.judgedAt).not.toBeNull();
  });
});

/**
 * The idempotency key, which is the one part of the judging loop that was not
 * idempotent until `submissions.clientNonce` existed.
 *
 * Everything downstream already had a guard somebody would trip over: a report
 * must hold the current lease, a verdict may only land on a row that is being
 * judged, `ensureProblem` upserts. The entrance had none, so a reply lost on
 * the way back cost a second row and a second slot in the queue for one thing
 * the player did once — and `use-submit.ts` retries, so the losing case is the
 * ordinary one rather than an exotic race.
 *
 * What holds it together is a unique index plus `on conflict do nothing`, and
 * neither is visible from the outside: a route that had dropped the nonce
 * entirely would still answer 201 to both clicks, and the suites above would
 * still pass. So these read the rows back out of Postgres.
 *
 * An externally judged problem, because the row then stays `queued` and the
 * count is about the insert rather than about what a judge did with it.
 */
describeDb("提交的幂等键", () => {
  const ALICE = "idem-alice";
  const BOB = "idem-bob";

  const EXTERNAL = problemsFor(AS_PLAYER)
    .map((view) => view.config)
    .find((config) => !isInlineBackend(config.backend));

  /** The rows this suite made, whoever made them. */
  async function rowsWithNonce(nonce: string) {
    return db
      .select()
      .from(submissions)
      .where(eq(submissions.clientNonce, nonce));
  }

  async function cleanup(): Promise<void> {
    for (const handle of [ALICE, BOB]) {
      await db.delete(submissions).where(eq(submissions.handle, handle));
      await db.delete(accounts).where(eq(accounts.handle, handle));
    }
  }

  beforeAll(async () => {
    for (const [key, value] of Object.entries(TEST_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubGlobal("fetch", fetchMock);

    await cleanup();
    for (const handle of [ALICE, BOB]) {
      await db
        .insert(accounts)
        .values({ handle, displayName: handle, source: "registration" });
    }
    CALLER = ALICE;
  });

  afterAll(async () => {
    await cleanup();
    CALLER = HANDLE;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /**
   * The case the index exists for. The read before the insert cannot decide
   * this one — both requests pass it — so deleting the index would leave the
   * route looking correct right up until two clicks genuinely overlap.
   */
  it("同一个 nonce 并发提交两次，只落一行", async () => {
    expect(EXTERNAL).toBeDefined();
    const nonce = "idem-race";

    const responses = await Promise.all([
      post({ problemSlug: EXTERNAL!.slug, payload: PAYLOAD, clientNonce: nonce }),
      post({ problemSlug: EXTERNAL!.slug, payload: PAYLOAD, clientNonce: nonce }),
    ]);

    const rows = await rowsWithNonce(nonce);
    expect(rows.length).toBe(1);

    // One of them created it and the other found it, and which is which is not
    // this test's business. What matters is that the loser is answered with the
    // winner's row rather than with the 500 that a missing recovery read would
    // produce.
    expect([...responses.map((response) => response.status)].sort()).toEqual([
      200, 201,
    ]);
    for (const response of responses) {
      expect((await response.json()).id).toBe(rows[0].id);
    }
  });

  /**
   * The retry the client actually makes: same nonce, seconds later, because the
   * first reply never arrived. 200 rather than 201 is the whole of what the
   * caller can see, and it is deliberately the only difference — the body is the
   * same shape either way, so a client reading `res.ok` cannot tell.
   */
  it("重放同一个 nonce 得到 200 与同一行，而不是第二次 201", async () => {
    const nonce = "idem-replay";
    const body = {
      problemSlug: EXTERNAL!.slug,
      payload: PAYLOAD,
      clientNonce: nonce,
    };

    const first = await post(body);
    expect(first.status).toBe(201);
    const created = await first.json();

    const second = await post(body);
    expect(second.status).toBe(200);
    expect((await second.json()).id).toBe(created.id);

    expect((await rowsWithNonce(nonce)).length).toBe(1);
  });

  /**
   * Not about the nonce, but about the other thing the entrance has to get
   * right before it writes: `""` is a client naming a contest and naming it
   * wrong, not a submission made outside any round. `submitFor` says so in as
   * many words; nothing until now held the route to the 400 it maps that to,
   * and the failure mode — an empty string silently succeeding as "no contest"
   * — puts a submission outside the round it was meant for.
   */
  it("contestSlug 是空串时 400，且什么也不写", async () => {
    const nonce = "idem-empty-contest";

    const response = await post({
      problemSlug: EXTERNAL!.slug,
      payload: PAYLOAD,
      contestSlug: "",
      clientNonce: nonce,
    });

    expect(response.status).toBe(400);
    expect(await rowsWithNonce(nonce)).toEqual([]);
  });

  /**
   * The index is over `(handle, client_nonce)` rather than the nonce alone, and
   * the difference is not bookkeeping: a nonce is a client's private counter,
   * minted by its own code, so two people colliding on one is ordinary — and
   * under a global key the second person's submission would be silently
   * answered with the first person's row.
   */
  it("两个人用同一个 nonce，各自都落一行", async () => {
    const nonce = "idem-shared";
    const body = {
      problemSlug: EXTERNAL!.slug,
      payload: PAYLOAD,
      clientNonce: nonce,
    };

    CALLER = ALICE;
    const mine = await post(body);
    expect(mine.status).toBe(201);
    const mineId = (await mine.json()).id;

    CALLER = BOB;
    const theirs = await post(body);
    expect(theirs.status).toBe(201);
    const theirsId = (await theirs.json()).id;
    CALLER = ALICE;

    expect(theirsId).not.toBe(mineId);

    // Each person's own row, rather than the second of them being answered
    // with the first's.
    const rows = await rowsWithNonce(nonce);
    const byHandle = new Map(rows.map((row) => [row.handle, row.id]));
    expect(byHandle.get(ALICE)).toBe(mineId);
    expect(byHandle.get(BOB)).toBe(theirsId);
  });
});
