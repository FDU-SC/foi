import { getSessionUser } from "@/auth";
import { viewerFor } from "@/lib/auth/viewer";
import { isTerminalState } from "@/lib/backend/types";
import { subscribe } from "@/lib/submissions/events";
import { submissionFor } from "@/lib/submissions/access";
import { toView } from "@/lib/submissions/queries";
import type { SubmissionView } from "@/lib/submissions/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 20_000;

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });

  const viewer = viewerFor(user);
  const initial = await submissionFor(id, viewer);
  if (!initial) return new Response("Not found", { status: 404 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const cleanups: (() => void)[] = [];

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
