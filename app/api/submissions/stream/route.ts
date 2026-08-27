import { getSessionUser } from "@/auth";
import { resolveUser } from "@/lib/accounts/resolve";
import { viewerFor } from "@/lib/permissions/viewer";
import { isSettled } from "@/lib/backend/types";
import { rateLimit } from "@/lib/ratelimit";
import {
  MAX_STREAMS_PER_HANDLE,
  streamConcurrency,
} from "@/lib/ratelimit/concurrency";
import { guardRequest } from "@/lib/ratelimit/gate";
import { ROUTE_LIMITS } from "@/lib/ratelimit/policy";
import { subscribe } from "@/lib/submissions/events";
import { submissionFor } from "@/lib/submissions/access";
import { toView } from "@/lib/submissions/queries";
import type { SubmissionView } from "@/lib/submissions/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 20_000;

export async function GET(request: Request) {
  const gated = guardRequest(request, "GET /api/submissions/stream");
  if (gated) return gated;

  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const opens = ROUTE_LIMITS["GET /api/submissions/stream"];
  if (
    !rateLimit(
      `stream:${user.handle}`,
      opens.max,
      opens.windowSeconds * 1000,
    ).ok
  ) {
    return new Response("Too Many Requests", { status: 429 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });

  const viewer = viewerFor(user);
  const initial = await submissionFor(id, viewer);
  if (!initial) return new Response("Not found", { status: 404 });

  /**
   * How many streams this account already holds, which the counter above
   * cannot answer: it bounds how often one is opened, and a connection that is
   * never closed is opened exactly once. Each stream costs a listener on the
   * process-wide bus and a heartbeat timer for as long as it lives.
   *
   * Taken last, after every refusal above, so a rejected request does not
   * consume a slot it was never going to use.
   */
  const release = streamConcurrency.acquire(
    `stream:${user.handle}`,
    MAX_STREAMS_PER_HANDLE,
  );
  if (!release) {
    return new Response("Too Many Requests", {
      status: 429,
      headers: { "retry-after": "5" },
    });
  }

  const encoder = new TextEncoder();

  /**
   * Teardown, outside `start` rather than closed over by it.
   *
   * `start`'s scope is the natural home for these until you account for
   * `cancel` — the callback the runtime invokes when the *reader* goes away,
   * which is what a closed tab or a proxy dropping the socket looks like from
   * in here. That path does not go anywhere near `request.signal`, so a
   * teardown armed only on abort is one an entire class of disconnects routes
   * around: the slot stays taken, the bus keeps a listener, and the heartbeat
   * keeps firing, until the process restarts. From the outside that is an
   * account which can no longer open streams, five tabs later, for a reason
   * nothing on the page connects to a tab it closed yesterday.
   *
   * Out here both paths reach them. `finish` is idempotent, so a disconnect
   * that raises the abort and the cancel releases once.
   */
  let closed = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const cleanups: (() => void)[] = [];

  // Registered before `start` can run at all, never mind before anything in it
  // that could close the stream — and that part is not hypothetical: a
  // submission that is already terminal closes inside the first `send` below,
  // before the subscription is ever added. Anything pushed after that point
  // would never run, and a slot that is taken and not returned is a leak that
  // only shows up as an account mysteriously unable to open streams.
  cleanups.push(release);

  /**
   * The single exit. `error` is the difference between the connection ending
   * because there is nothing more to say and it ending because something broke
   * — the client reconnects either way, but a stream that closes cleanly on a
   * failure claims the submission is settled when it is not.
   */
  const finish = (error?: unknown) => {
    if (closed) return;
    closed = true;
    for (const cleanup of cleanups) cleanup();
    try {
      if (error === undefined) controller?.close();
      else controller?.error(error);
    } catch {
      // Already closed by the runtime, which is the ordinary case on the
      // cancel path: the reader is gone and the controller went with it before
      // we were told.
    }
  };

  // Takes no arguments of its own, which is what lets it be handed straight to
  // `addEventListener` and to `cancel` below without an abort event or a
  // cancellation reason arriving as a failure.
  const close = () => finish();

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      controller = streamController;

      const send = (view: SubmissionView) => {
        if (closed) return;
        try {
          streamController.enqueue(
            encoder.encode(`data: ${JSON.stringify(view)}\n\n`),
          );
        } catch {
          close();
          return;
        }
        if (isSettled(view.state)) close();
      };

      /**
       * Everything from here on runs under the catch, and the re-read below is
       * why: it is a database call, so it can fail for reasons that have
       * nothing to do with this connection.
       *
       * A throw out of `start` is swallowed by the stream machinery, and by
       * then this handler is holding a concurrency slot and, past the
       * subscription, a listener on the process-wide bus. Neither is collected
       * by anything else — the abort listener that would eventually run
       * `close` is registered on the last line of this block, so a failure
       * before that leaves no path to it at all, and the account can no longer
       * open streams for a reason nothing on the page or in the log connects
       * to a database blip minutes earlier.
       */
      try {
        streamController.enqueue(encoder.encode("retry: 5000\n\n"));
        send(toView(initial));
        if (closed) return;

        cleanups.push(subscribe(id, send));

        // A verdict can land between the snapshot above and the subscription
        // being active. Re-read once now that we are listening so that update
        // is not lost. Duplicate frames are harmless — the client is idempotent.
        const afterSubscribe = await submissionFor(id, viewer);
        if (afterSubscribe) send(toView(afterSubscribe));
        if (closed) return;

        /**
         * The one place a suspension can reach a connection that is already up.
         *
         * Everywhere else in the application re-resolves the account per
         * request, so "the session dies on the next request" is true — but a
         * stream makes no further requests. It was authorised once and then
         * held open for as long as the submission takes, which is exactly the
         * window somebody being suspended mid-contest is still inside. The
         * heartbeat was already running, and the check costs one lookup by
         * primary key.
         *
         * `resolveUser` rather than `getResolvedUser`, because this runs on a
         * timer long after the request that created it: there is no request
         * scope left to read a cookie from, and the handle was fixed when the
         * stream opened anyway. What that gives up is the password-epoch half
         * of `getResolvedUser` — a reset ends the session on the next request,
         * not on this stream — and only suspension is in scope here.
         *
         * A failed lookup leaves the stream alone rather than closing it. Every
         * client reconnects on close, so failing closed during a database blip
         * would turn one outage into a reconnect storm, and one more heartbeat
         * of a suspended account reading its own submission is the smaller
         * harm.
         *
         * Judging is deliberately untouched: work already handed to a backend
         * runs to completion, since cancelling it would leave an orphan task
         * there and the verdict has nowhere to be shown anyway.
         */
        const heartbeat = setInterval(() => {
          if (closed) return;
          void (async () => {
            const account = await resolveUser(user.handle).catch(
              () => undefined,
            );
            if (closed) return;
            if (account === null || account?.disabled) {
              close();
              return;
            }

            try {
              streamController.enqueue(encoder.encode(": ping\n\n"));
            } catch {
              close();
            }
          })();
        }, HEARTBEAT_MS);
        cleanups.push(() => clearInterval(heartbeat));

        request.signal.addEventListener("abort", close);
      } catch (error) {
        // Logged as well as reported, because the client sees only a dropped
        // connection and will reconnect into the same failure: without this
        // the only trace of a stream that cannot start is the reconnect rate.
        console.error("[foi] 提交事件流启动失败", error);
        finish(error);
      }
    },

    /**
     * The reader letting go, which is how an ordinary client disconnect
     * arrives when nothing aborts the request that opened this. Same `close`
     * as everywhere else, so the two ends of the connection dying in either
     * order costs one release.
     *
     * The cancellation reason is deliberately dropped rather than forwarded to
     * `finish`: it describes why the reader left, not a failure to report back
     * to it, and there is nobody left to report to in any case.
     */
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx buffers proxied responses by default, which breaks SSE.
      "x-accel-buffering": "no",
    },
  });
}
