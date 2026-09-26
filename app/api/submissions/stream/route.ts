import { getSessionUser } from "@/auth";
import { denialFor } from "@/lib/authz/actions";
import { denied, UNAUTHENTICATED } from "@/lib/authz/adapters";
import { apiDeny } from "@/lib/authz/http";
import { viewerFor } from "@/lib/authz/viewer";
import { rateLimit } from "@/lib/ratelimit";
import {
  MAX_STREAMS_PER_UID,
  streamConcurrency,
} from "@/lib/ratelimit/concurrency";
import { guardRequest } from "@/lib/server/guard";
import { ROUTE_LIMITS } from "@/lib/ratelimit/policy";
import { submissionStream } from "@/lib/submissions/stream";
import { submissionFor } from "@/lib/submissions/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gated = guardRequest(request, "GET /api/submissions/stream");
  if (gated) return gated;

  const user = await getSessionUser();
  if (!user) return apiDeny(UNAUTHENTICATED);

  const opens = ROUTE_LIMITS["GET /api/submissions/stream"];
  if (!rateLimit(`stream:${user.uid}`, opens).ok) {
    return new Response("Too Many Requests", { status: 429 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });

  const release = streamConcurrency.acquire(
    `stream:${user.uid}`,
    MAX_STREAMS_PER_UID,
  );
  if (!release) {
    return new Response("Too Many Requests", {
      status: 429,
      headers: { "retry-after": "5" },
    });
  }

  let stream: ReadableStream<Uint8Array>;
  try {
    const viewer = viewerFor(user);
    const initial = await submissionFor(id, viewer, request.signal);
    if (!initial) {
      release();
      return apiDeny(denied(denialFor("submission.read")));
    }
    stream = submissionStream({ id, viewer, initial: initial.view, signal: request.signal, onClose: release });
  } catch (error) {
    release();
    throw error;
  }

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",

      "x-accel-buffering": "no",
    },
  });
}
