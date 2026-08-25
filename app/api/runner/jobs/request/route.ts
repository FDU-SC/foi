import { NextResponse } from "next/server";
import { readTextBody } from "@/lib/body-limit";
import { guardRequest } from "@/lib/ratelimit/gate";
import { jobRequestSchema } from "@/lib/backend/types";
import { CLAIM_PATH, verifyRunner } from "@/lib/runner/auth";
import { claimJob } from "@/lib/runner/queue";

// Signature verification uses node:crypto, so this must not run on Edge.
export const runtime = "nodejs";

/** A backend id and a runner id. Nothing else is ever sent here. */
const MAX_BODY_BYTES = 4 * 1024;

/**
 * Where runners come for work.
 *
 * Short polling, once a second or two, and that is the whole transport. GitLab
 * runs long polling through Workhorse and Redis; that is a consequence of their
 * scale rather than of the design, and four backends do not need it.
 *
 * The answer is an id and a lease, or 204. It will not grow fields: everything
 * an evaluation needs is behind `GET /api/runner/jobs/{id}`, so a runner that
 * prefetches claims several of these and then fetches several sets of details,
 * with nothing in the protocol having to know that is what it is doing.
 */
export async function POST(request: Request) {
  // Before the body is read and before an HMAC is computed. Like the retired
  // callback route, this endpoint answers to nobody — its credential is in a
  // header over a body it has not read yet — so the source gate is the only
  // bound that can come first.
  const gated = guardRequest(request, "POST /api/runner/jobs/request");
  if (gated) return gated;

  const read = await readTextBody(request, MAX_BODY_BYTES);
  if (!read.ok) {
    return NextResponse.json({ error: "请求体过大" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = jobRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "领取请求格式不合法" }, { status: 400 });
  }

  // The body says which queue; the signature has to be that backend's. Checked
  // before anything touches the database, so an unsigned caller cannot make
  // this process write a `runners` row.
  const signature = verifyRunner(parsed.data.backendId, request, {
    method: "POST",
    path: CLAIM_PATH,
    body: read.text,
  });
  if (!signature.ok) {
    return NextResponse.json({ error: signature.reason }, { status: 401 });
  }

  const ticket = await claimJob(parsed.data.backendId, parsed.data.runnerId);

  // 204 rather than `{ job: null }`: an idle queue is the common case by a wide
  // margin, and a runner polling every second should not have to parse a body
  // to learn there is nothing.
  if (!ticket) return new NextResponse(null, { status: 204 });

  return NextResponse.json(ticket, {
    headers: { "cache-control": "no-store" },
  });
}
