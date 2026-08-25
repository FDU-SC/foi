import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/submissions/stream/route";
import { db } from "@/lib/db";
import { accounts, problems, submissions } from "@/lib/db/schema";
import { externallyJudged } from "@/lib/problems/registry";
import {
  MAX_STREAMS_PER_HANDLE,
  streamConcurrency,
} from "@/lib/ratelimit/concurrency";

/**
 * What an SSE connection gives back when the client goes away.
 *
 * Against the handler rather than a layer down, which the rest of this suite
 * avoids on principle — but the thing being asserted is the wiring of the
 * `ReadableStream` itself, and there is no layer down. A stream holds two
 * things for as long as it lives: a slot out of `MAX_STREAMS_PER_HANDLE` and a
 * listener on the process-wide bus. Neither is reclaimed by garbage
 * collection, and both were released from exactly one place — an `abort` on
 * the request.
 *
 * A reader letting go is the other way this ends, and the requests below have
 * no abort at all: `request.signal` on a `Request` nobody aborts never fires,
 * which is the point. The failure it stands for is silent and cumulative — the
 * account keeps working until the fifth tab, and then stops being able to open
 * streams at all, for a reason nothing in the log connects to a tab closed
 * yesterday.
 */

const HANDLE = "sse-cancel-alice";
const SLOT = `stream:${HANDLE}`;
const PROBLEM = externallyJudged()[0]!;
const SUBMISSION = "sub_sse_cancel";
const CHANNEL = `submission:${SUBMISSION}`;

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

// The route asks `@/auth` who is calling; the database, the access gate and
// the concurrency counter all run for real.
vi.mock("@/auth", () => ({
  getSessionUser: async () => ({
    handle: "sse-cancel-alice",
    displayName: "sse-cancel-alice",
    groups: [],
  }),
}));

/** Listeners this submission's channel is carrying, leaks included. */
const subscribers = (): number =>
  globalThis.__foiSubmissionBus?.listenerCount(CHANNEL) ?? 0;

/** Readers opened by the running test, so a failure cannot leak into the next. */
const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];

const openStream = (): Promise<Response> =>
  GET(
    new Request(`http://localhost:3000/api/submissions/stream?id=${SUBMISSION}`),
  );

/**
 * A stream that is all the way up.
 *
 * Two frames, not one: `start` sends `retry:` and the current row back to
 * back, then awaits a re-read before subscribing to anything or arming the
 * heartbeat. Waiting for the frame on the far side of that await is what makes
 * the assertions afterwards about a fully established connection rather than a
 * half-built one.
 */
async function openEstablished(): Promise<Response> {
  const response = await openStream();
  const reader = response.body!.getReader();
  readers.push(reader);
  await reader.read();
  await reader.read();
  return response;
}

async function cleanup(): Promise<void> {
  await db.delete(submissions).where(eq(submissions.handle, HANDLE));
  await db.delete(accounts).where(eq(accounts.handle, HANDLE));
}

describeDb("提交事件流的清理", () => {
  beforeAll(async () => {
    await cleanup();
    await db
      .insert(problems)
      .values({ slug: PROBLEM.slug, title: PROBLEM.title })
      .onConflictDoNothing();
    await db
      .insert(accounts)
      .values({ handle: HANDLE, displayName: HANDLE, source: "registration" });
    // Queued, so nothing is settled and the stream stays open on its own.
    await db.insert(submissions).values({
      id: SUBMISSION,
      handle: HANDLE,
      problemSlug: PROBLEM.slug,
      payload: {},
      backendId: "sse-cancel-fixture",
      state: "queued",
    });
  });

  afterEach(async () => {
    await Promise.all(readers.map((reader) => reader.cancel().catch(() => {})));
    readers.length = 0;
  });

  afterAll(cleanup);

  it("读端撤销时，并发槽与总线监听器都还回去", async () => {
    await openEstablished();

    expect(streamConcurrency.held(SLOT)).toBe(1);
    expect(subscribers()).toBe(1);

    await readers[0]!.cancel();

    expect(streamConcurrency.held(SLOT)).toBe(0);
    expect(subscribers()).toBe(0);
  });

  /**
   * The consequence, stated the way the person on the other end meets it. A
   * slot that is never returned is invisible until it is the last one, so the
   * assertion worth having is not that a counter went down but that closing
   * five tabs leaves you able to open a sixth.
   */
  it("撤销过的流不再占额度，开满之后全撤还能再开", async () => {
    for (let i = 0; i < MAX_STREAMS_PER_HANDLE; i += 1) {
      const response = await openEstablished();
      expect(response.status).toBe(200);
    }
    expect(streamConcurrency.held(SLOT)).toBe(MAX_STREAMS_PER_HANDLE);

    await Promise.all(readers.map((reader) => reader.cancel()));
    expect(streamConcurrency.held(SLOT)).toBe(0);

    const again = await openStream();
    expect(again.status).toBe(200);
    await again.body?.cancel();
  });
});
