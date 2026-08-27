import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/submissions/route";
import { AS_PLAYER } from "@/test/auth-support";
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
  type InlineBackend,
  type InlineJudge,
} from "@/lib/problems/types";
import { inlineProblem } from "@/test/content-shapes";

const HANDLE = "rl-alice";

const DEFAULT_CALLER = HANDLE;

const [FIRST, SECOND] = problemsFor(AS_PLAYER).map((view) => view.config);

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

let CALLER = HANDLE;

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

    expect(fetchMock).not.toHaveBeenCalled();

    const rows = await db
      .select()
      .from(submissions)
      .where(eq(submissions.handle, HANDLE));
    expect(rows.length).toBe(allowed);
  });

  it("一道题用光配额不影响另一道题", async () => {
    expect(SECOND.slug).not.toBe(FIRST.slug);

    const response = await postSubmission(SECOND.slug);
    expect(response.status).toBe(201);
  });
});

describeDb("内联判题的提交", () => {
  const INLINE = problemsFor(AS_PLAYER)
    .map((view) => view.config)
    .find((config) => isInlineBackend(config.backend));

  const HANDLE = "rl-inline";

  beforeAll(async () => {
    CALLER = HANDLE;
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
    CALLER = DEFAULT_CALLER;
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

describeDb("内联判题说自己判不了", () => {
  const PROBLEM = inlineProblem();
  const REASON = "夹具：这道题此刻判不了";
  const HANDLE = "rl-unavailable";
  let restore: InlineJudge;

  beforeAll(async () => {
    CALLER = HANDLE;
    for (const [key, value] of Object.entries(TEST_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubGlobal("fetch", fetchMock);

    const backend = PROBLEM.backend as InlineBackend;
    restore = backend.judge;
    backend.judge = () => ({ unavailable: true, reason: REASON });

    await db.delete(submissions).where(eq(submissions.handle, HANDLE));
    await db.delete(accounts).where(eq(accounts.handle, HANDLE));
    await db
      .insert(accounts)
      .values({ handle: HANDLE, displayName: HANDLE, source: "registration" });
  });

  afterAll(async () => {
    CALLER = DEFAULT_CALLER;
    (PROBLEM.backend as InlineBackend).judge = restore;
    await db.delete(submissions).where(eq(submissions.handle, HANDLE));
    await db.delete(accounts).where(eq(accounts.handle, HANDLE));
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("落 disrupted 带上原因，而不是一个零分的 completed", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
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
      .where(eq(submissions.handle, HANDLE));

    expect(row.state).toBe("disrupted");
    expect(row.error).toContain(REASON);

    expect(row.verdict).toBeNull();
    expect(row.outcome).toBeNull();
    expect(row.score).toBeNull();
    expect(row.accepted).toBeNull();
    expect(row.judgedAt).not.toBeNull();
  });
});

describeDb("提交的幂等键", () => {
  const ALICE = "idem-alice";
  const BOB = "idem-bob";

  const EXTERNAL = problemsFor(AS_PLAYER)
    .map((view) => view.config)
    .find((config) => !isInlineBackend(config.backend));

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

  it("同一个 nonce 并发提交两次，只落一行", async () => {
    expect(EXTERNAL).toBeDefined();
    const nonce = "idem-race";

    const responses = await Promise.all([
      post({ problemSlug: EXTERNAL!.slug, payload: PAYLOAD, clientNonce: nonce }),
      post({ problemSlug: EXTERNAL!.slug, payload: PAYLOAD, clientNonce: nonce }),
    ]);

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

    const rows = await rowsWithNonce(nonce);
    const byHandle = new Map(rows.map((row) => [row.handle, row.id]));
    expect(byHandle.get(ALICE)).toBe(mineId);
    expect(byHandle.get(BOB)).toBe(theirsId);
  });
});
