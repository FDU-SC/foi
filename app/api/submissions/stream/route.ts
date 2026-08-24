import { getSessionUser } from "@/auth";
import { viewerFor } from "@/lib/auth/viewer";
import { isTerminalState } from "@/lib/backend/types";
import { rateLimit } from "@/lib/ratelimit";
import {
  MAX_STREAMS_PER_HANDLE,
  streamConcurrency,
} from "@/lib/ratelimit/concurrency";
import { sourceGate } from "@/lib/ratelimit/gate";
import { fixedRule, ROUTE_LIMITS } from "@/lib/ratelimit/policy";
import { subscribe } from "@/lib/submissions/events";
import { submissionFor } from "@/lib/submissions/access";
import { toView } from "@/lib/submissions/queries";
import type { SubmissionView } from "@/lib/submissions/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 20_000;

export async function GET(request: Request) {
  const gated = sourceGate(request, "GET /api/submissions/stream");
  if (gated) return gated;

  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const opens = fixedRule(ROUTE_LIMITS["GET /api/submissions/stream"]);
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

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const cleanups: (() => void)[] = [];

      // Registered before anything that could close the stream, which is not
      // hypothetical: a submission that is already terminal closes inside the
      // first `send` below, before the subscription is ever added. Anything
      // pushed after that point would never run, and a slot that is taken and
      // not returned is a leak that only shows up as an account mysteriously
      // unable to open streams.
      cleanups.push(release);

      const close = () => {
        if (closed) return;
        closed = true;
        for (const cleanup of cleanups) cleanup();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      const send = (view: SubmissionView) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(view)}\n\n`));
        } catch {
          close();
          return;
        }
        if (isTerminalState(view.state)) close();
      };

      controller.enqueue(encoder.encode("retry: 5000\n\n"));
      send(toView(initial));
      if (closed) return;

      cleanups.push(subscribe(id, send));

      // A verdict can land between the snapshot above and the subscription
      // being active. Re-read once now that we are listening so that update
      // is not lost. Duplicate frames are harmless — the client is idempotent.
      const afterSubscribe = await submissionFor(id, viewer);
      if (afterSubscribe) send(toView(afterSubscribe));
      if (closed) return;

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          close();
        }
      }, HEARTBEAT_MS);
      cleanups.push(() => clearInterval(heartbeat));

      request.signal.addEventListener("abort", close);
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
