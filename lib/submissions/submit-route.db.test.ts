import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/submissions/route";
import { db } from "@/lib/db";
import { accounts, submissions } from "@/lib/db/schema";
import {
  INLINE_BACKEND_ID,
  INLINE_BACKEND_VERSION,
} from "@/lib/backend/types";
import { contestProblemRefs } from "@/lib/contests/refs";
import { acceptsSubmissions } from "@/lib/contests/types";
import {
  submitRateLimit,
  type InlineBackend,
  type InlineJudge,
} from "@/lib/problems/types";
import {
  inlineProblem,
  openContestProblem,
  openExternalProblem,
} from "@/test/content-shapes";

const USERNAME = "rl-alice";
let ACCOUNT_UID = 0;

/** Reachable right now, because the route reads the real clock. */
const OPEN = contestProblemRefs().filter((ref) =>
  acceptsSubmissions(ref.contest, new Date()),
);

const FIRST = openContestProblem();
const SECOND = OPEN.find(
  (ref) => ref.problem.slug !== FIRST.problem.slug,
)!;

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

let CALLER_UID = 0;
let CALLER_USERNAME = USERNAME;

vi.mock("@/auth", () => ({
  getResolvedUser: async () => ({
    uid: CALLER_UID,
    username: CALLER_USERNAME,
    nickname: CALLER_USERNAME,
    email: null,
    emailVerified: false,
    groups: [],
    status: "active",
    disabled: false,
  }),
  getSessionUser: async () => ({
    uid: CALLER_UID,
    username: CALLER_USERNAME,
    nickname: CALLER_USERNAME,
    groups: [],
  }),
}));

const TEST_ENV = {
  FOI_PUBLIC_URL: "http://localhost:3000",
  FOI_BACKEND_SECRET: "submit-route-suite-signing-key",
} as const;

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

function postSubmission(ref: {
  contest: { slug: string };
  problem: { slug: string };
}): Promise<Response> {
  return post({
    contestSlug: ref.contest.slug,
    problemSlug: ref.problem.slug,
    payload: PAYLOAD,
  });
}

describeDb("提交端点限流", () => {
  beforeAll(async () => {
    for (const [key, value] of Object.entries(TEST_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubGlobal("fetch", fetchMock);

    await db.delete(accounts).where(eq(accounts.username, USERNAME));
    const [acct] = await db
      .insert(accounts)
      .values({ username: USERNAME, nickname: USERNAME })
      .returning({ uid: accounts.uid });
    ACCOUNT_UID = acct.uid;
    CALLER_UID = ACCOUNT_UID;
    CALLER_USERNAME = USERNAME;
  });

  afterAll(async () => {
    await db.delete(submissions).where(eq(submissions.uid, ACCOUNT_UID));
    await db.delete(accounts).where(eq(accounts.uid, ACCOUNT_UID));
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("窗口内的提交照常落地，超出上限的得到 429 且不留行", async () => {
    const allowed = submitRateLimit(FIRST.problem, FIRST.entry.rateLimit).max;

    for (let i = 0; i < allowed; i += 1) {
      const response = await postSubmission(FIRST);
      expect(response.status).toBe(201);
    }

    const rejected = await postSubmission(FIRST);
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).not.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();

    const rows = await db
      .select()
      .from(submissions)
      .where(eq(submissions.uid, ACCOUNT_UID));
    expect(rows.length).toBe(allowed);
  });

  it("一道题用光配额不影响另一道题", async () => {
    expect(SECOND.problem.slug).not.toBe(FIRST.problem.slug);

    const response = await postSubmission(SECOND);
    expect(response.status).toBe(201);
  });
});

describeDb("内联判题的提交", () => {
  const INLINE = inlineProblem();

  const INLINE_USERNAME = "rl-inline";
  let INLINE_UID = 0;

  beforeAll(async () => {
    for (const [key, value] of Object.entries(TEST_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("AUTH_SECRET", "inline-suite-key-0123456789abcdef");
    vi.stubGlobal("fetch", fetchMock);

    await db.delete(accounts).where(eq(accounts.username, INLINE_USERNAME));
    const [acct] = await db
      .insert(accounts)
      .values({ username: INLINE_USERNAME, nickname: INLINE_USERNAME })
      .returning({ uid: accounts.uid });
    INLINE_UID = acct.uid;
    CALLER_UID = INLINE_UID;
    CALLER_USERNAME = INLINE_USERNAME;
  });

  afterAll(async () => {
    CALLER_UID = ACCOUNT_UID;
    CALLER_USERNAME = USERNAME;
    await db.delete(submissions).where(eq(submissions.uid, INLINE_UID));
    await db.delete(accounts).where(eq(accounts.uid, INLINE_UID));
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("一次请求里判完，落库时已经是终态", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contestSlug: INLINE.contest.slug,
          problemSlug: INLINE.problem.slug,
          payload: { text: "definitely not the answer" },
        }),
      }),
    );

    expect(response.status).toBe(201);

    const [row] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.uid, INLINE_UID));

    expect(row.state).toBe("completed");
    expect(row.result).not.toBeNull();

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
          contestSlug: INLINE.contest.slug,
          problemSlug: INLINE.problem.slug,
          payload: { text: "still not the answer" },
        }),
      }),
    );

    expect(fetchMock.mock.calls.length).toBe(before);
  });
});

describeDb("内联判题说自己判不了", () => {
  const REF = inlineProblem();
  const PROBLEM = REF.problem;
  const REASON = "夹具：这道题此刻判不了";
  const UNAVAIL_USERNAME = "rl-unavailable";
  let UNAVAIL_UID = 0;
  let restore: InlineJudge;

  beforeAll(async () => {
    for (const [key, value] of Object.entries(TEST_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubGlobal("fetch", fetchMock);

    const backend = PROBLEM.backend as InlineBackend;
    restore = backend.judge;
    backend.judge = () => ({ unavailable: true, reason: REASON });

    await db.delete(accounts).where(eq(accounts.username, UNAVAIL_USERNAME));
    const [acct] = await db
      .insert(accounts)
      .values({ username: UNAVAIL_USERNAME, nickname: UNAVAIL_USERNAME })
      .returning({ uid: accounts.uid });
    UNAVAIL_UID = acct.uid;
    CALLER_UID = UNAVAIL_UID;
    CALLER_USERNAME = UNAVAIL_USERNAME;
  });

  afterAll(async () => {
    CALLER_UID = ACCOUNT_UID;
    CALLER_USERNAME = USERNAME;
    (PROBLEM.backend as InlineBackend).judge = restore;
    await db.delete(submissions).where(eq(submissions.uid, UNAVAIL_UID));
    await db.delete(accounts).where(eq(accounts.uid, UNAVAIL_UID));
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("落 disrupted 带上原因，而不是一个零分的 completed", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contestSlug: REF.contest.slug,
          problemSlug: PROBLEM.slug,
          payload: { text: "red" },
        }),
      }),
    );

    expect(response.status).toBe(201);

    expect((await response.json()).state).toBe("disrupted");

    const [row] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.uid, UNAVAIL_UID));

    expect(row.state).toBe("disrupted");
    expect(row.error).toContain(REASON);

    expect(row.result).toBeNull();
    expect(row.detail).toBeNull();
    expect(row.judgedAt).not.toBeNull();
  });
});

describeDb("提交的幂等键", () => {
  const ALICE_USERNAME = "idem-alice";
  const BOB_USERNAME = "idem-bob";
  let ALICE_UID = 0;
  let BOB_UID = 0;

  const EXTERNAL = openExternalProblem();

  async function rowsWithNonce(nonce: string) {
    return db
      .select()
      .from(submissions)
      .where(eq(submissions.clientNonce, nonce));
  }

  async function cleanup(): Promise<void> {
    for (const uid of [ALICE_UID, BOB_UID]) {
      if (uid) {
        await db.delete(submissions).where(eq(submissions.uid, uid));
        await db.delete(accounts).where(eq(accounts.uid, uid));
      }
    }
  }

  beforeAll(async () => {
    for (const [key, value] of Object.entries(TEST_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubGlobal("fetch", fetchMock);

    await db.delete(accounts).where(eq(accounts.username, ALICE_USERNAME));
    await db.delete(accounts).where(eq(accounts.username, BOB_USERNAME));

    const [alice] = await db
      .insert(accounts)
      .values({ username: ALICE_USERNAME, nickname: ALICE_USERNAME })
      .returning({ uid: accounts.uid });
    ALICE_UID = alice.uid;

    const [bob] = await db
      .insert(accounts)
      .values({ username: BOB_USERNAME, nickname: BOB_USERNAME })
      .returning({ uid: accounts.uid });
    BOB_UID = bob.uid;

    CALLER_UID = ALICE_UID;
    CALLER_USERNAME = ALICE_USERNAME;
  });

  afterAll(async () => {
    await cleanup();
    CALLER_UID = ACCOUNT_UID;
    CALLER_USERNAME = USERNAME;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("同一个 nonce 并发提交两次，只落一行", async () => {
    const nonce = "idem-race";
    const body = {
      contestSlug: EXTERNAL.contest.slug,
      problemSlug: EXTERNAL.problem.slug,
      payload: PAYLOAD,
      clientNonce: nonce,
    };

    const responses = await Promise.all([post(body), post(body)]);

    const rows = await rowsWithNonce(nonce);
    expect(rows.length).toBe(1);

    expect([...responses.map((response) => response.status)].sort()).toEqual([
      200, 201,
    ]);
    for (const response of responses) {
      expect((await response.json()).id).toBe(rows[0].id);
    }
  });

  it("重放同一个 nonce 得到 200 与同一行，而不是第二次 201", async () => {
    const nonce = "idem-replay";
    const body = {
      contestSlug: EXTERNAL.contest.slug,
      problemSlug: EXTERNAL.problem.slug,
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

  it("contestSlug 是空串时 400，且什么也不写", async () => {
    const nonce = "idem-empty-contest";

    const response = await post({
      problemSlug: EXTERNAL.problem.slug,
      payload: PAYLOAD,
      contestSlug: "",
      clientNonce: nonce,
    });

    expect(response.status).toBe(400);
    expect(await rowsWithNonce(nonce)).toEqual([]);
  });

  it("两个人用同一个 nonce，各自都落一行", async () => {
    const nonce = "idem-shared";
    const body = {
      contestSlug: EXTERNAL.contest.slug,
      problemSlug: EXTERNAL.problem.slug,
      payload: PAYLOAD,
      clientNonce: nonce,
    };

    CALLER_UID = ALICE_UID;
    CALLER_USERNAME = ALICE_USERNAME;
    const mine = await post(body);
    expect(mine.status).toBe(201);
    const mineId = (await mine.json()).id;

    CALLER_UID = BOB_UID;
    CALLER_USERNAME = BOB_USERNAME;
    const theirs = await post(body);
    expect(theirs.status).toBe(201);
    const theirsId = (await theirs.json()).id;
    CALLER_UID = ALICE_UID;
    CALLER_USERNAME = ALICE_USERNAME;

    expect(theirsId).not.toBe(mineId);

    const rows = await rowsWithNonce(nonce);
    const byUid = new Map(rows.map((row) => [row.uid, row.id]));
    expect(byUid.get(ALICE_UID)).toBe(mineId);
    expect(byUid.get(BOB_UID)).toBe(theirsId);
  });
});
