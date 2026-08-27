import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/submissions/stream/route";
import { db } from "@/lib/db";
import { accounts, judgingQueue, problems, submissions } from "@/lib/db/schema";
import { externallyJudged } from "@/lib/problems/registry";
import {
  MAX_STREAMS_PER_UID,
  streamConcurrency,
} from "@/lib/ratelimit/concurrency";

const USERNAME = "sse-cancel-alice";
let ACCOUNT_UID = 0;
const PROBLEM = externallyJudged()[0]!;
const SUBMISSION = "sub_sse_cancel";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

vi.mock("@/auth", () => ({
  getSessionUser: async () => ({
    uid: ACCOUNT_UID,
    username: USERNAME,
    nickname: USERNAME,
    groups: [],
  }),
}));

const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];

const openStream = (): Promise<Response> =>
  GET(
    new Request(`http://localhost:3000/api/submissions/stream?id=${SUBMISSION}`),
  );

async function openEstablished(): Promise<Response> {
  const response = await openStream();
  const reader = response.body!.getReader();
  readers.push(reader);
  await reader.read();
  await reader.read();
  return response;
}

async function cleanup(): Promise<void> {
  if (ACCOUNT_UID) {
    await db.delete(submissions).where(eq(submissions.uid, ACCOUNT_UID));
    await db.delete(accounts).where(eq(accounts.uid, ACCOUNT_UID));
  }
}

describeDb("提交事件流的清理", () => {
  beforeAll(async () => {
    await cleanup();
    await db
      .insert(problems)
      .values({ slug: PROBLEM.slug, title: PROBLEM.title })
      .onConflictDoNothing();
    const [acct] = await db
      .insert(accounts)
      .values({ username: USERNAME, nickname: USERNAME })
      .returning({ uid: accounts.uid });
    ACCOUNT_UID = acct.uid;

    await db.insert(submissions).values({
      id: SUBMISSION,
      uid: ACCOUNT_UID,
      problemSlug: PROBLEM.slug,
      payload: {},
      backendId: "sse-cancel-fixture",
      state: "pending",
    });
    await db.insert(judgingQueue).values({
      submissionId: SUBMISSION,
      backendId: "sse-cancel-fixture",
      state: "waiting",
    });
  });

  afterEach(async () => {
    await Promise.all(readers.map((reader) => reader.cancel().catch(() => {})));
    readers.length = 0;
  });

  afterAll(cleanup);

  it("读端撤销时，并发槽还回去", async () => {
    const SLOT = `stream:${ACCOUNT_UID}`;
    await openEstablished();

    expect(streamConcurrency.held(SLOT)).toBe(1);

    await readers[0]!.cancel();

    expect(streamConcurrency.held(SLOT)).toBe(0);
  });

  it("撤销过的流不再占额度，开满之后全撤还能再开", async () => {
    const SLOT = `stream:${ACCOUNT_UID}`;
    for (let i = 0; i < MAX_STREAMS_PER_UID; i += 1) {
      const response = await openEstablished();
      expect(response.status).toBe(200);
    }
    expect(streamConcurrency.held(SLOT)).toBe(MAX_STREAMS_PER_UID);

    await Promise.all(readers.map((reader) => reader.cancel()));
    expect(streamConcurrency.held(SLOT)).toBe(0);

    const again = await openStream();
    expect(again.status).toBe(200);
    await again.body?.cancel();
  });
});
