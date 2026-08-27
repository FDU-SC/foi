import { getSessionUser } from "@/auth";
import { resolveUser } from "@/lib/accounts/resolve";
import { viewerFor } from "@/lib/permissions/viewer";
import { isSettled } from "@/lib/backend/types";
import { rateLimit } from "@/lib/ratelimit";
import {
  MAX_STREAMS_PER_HANDLE,
  streamConcurrency,
} from "@/lib/ratelimit/concurrency";
import { guardRequest } from "@/lib/server/guard";
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

  let closed = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const cleanups: (() => void)[] = [];

  cleanups.push(release);

  const finish = (error?: unknown) => {
    if (closed) return;
    closed = true;
    for (const cleanup of cleanups) cleanup();
    try {
      if (error === undefined) controller?.close();
      else controller?.error(error);
    } catch {

    }
  };

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

      try {
        streamController.enqueue(encoder.encode("retry: 5000\n\n"));
        send(toView(initial));
        if (closed) return;

        cleanups.push(subscribe(id, send));

        const afterSubscribe = await submissionFor(id, viewer);
        if (afterSubscribe) send(toView(afterSubscribe));
        if (closed) return;

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

        console.error("[foi] 提交事件流启动失败", error);
        finish(error);
      }
    },

    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",

      "x-accel-buffering": "no",
    },
  });
}
