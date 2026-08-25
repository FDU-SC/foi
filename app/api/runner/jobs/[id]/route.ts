import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { SignedRequest } from "@/lib/backend/signature";
import { jobReportSchema } from "@/lib/backend/types";
import { readTextBody } from "@/lib/body-limit";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { guardRequest } from "@/lib/ratelimit/gate";
import { jobPath, signedByAnyBackend, verifyRunner } from "@/lib/runner/auth";
import {
  jobDetails,
  reportAlive,
  reportDone,
  reportFailed,
} from "@/lib/runner/queue";

// Signature verification uses node:crypto, so this must not run on Edge.
export const runtime = "nodejs";

/**
 * Generous, because a verdict's `detail` carries whatever the backend wants to
 * show — a compile log, a diff, a per-test breakdown — and bounded anyway,
 * because nothing below this line runs until the body has fit.
 */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Which backend a job belongs to, or null when there is no such job.
 *
 * Both endpoints below need this before they can verify anything, because the
 * signing key is the one belonging to the backend the row names — there is no
 * caller-supplied backend id here to trust or to check.
 */
async function backendOf(id: string): Promise<string | null> {
  const [row] = await db
    .select({ backendId: submissions.backendId })
    .from(submissions)
    .where(eq(submissions.id, id))
    .limit(1);
  return row?.backendId ?? null;
}

/**
 * The one thing an unproven caller is ever told, on either branch.
 *
 * Deliberately the same wording `verifySignature` gives a forgery, so that
 * "your signature is wrong" and "there is no such submission" are the same
 * sentence.
 */
const UNPROVEN = "签名不匹配";

/**
 * Whether this caller may act on this id, and what to say when it may not.
 *
 * Both endpoints below have to look the row up before they can verify
 * anything, because the key a signature is checked against belongs to the
 * backend the *row* names — there is no caller-supplied backend id here to
 * trust. So the refusal for an id that is not there was written in one place
 * and the refusal for a bad signature in another, and the two disagreed:
 *
 *   - no signature headers, id does not exist → 401 `{"error":"签名不匹配"}`
 *   - no signature headers, id exists         → 401 `{"error":"缺少签名头"}`
 *
 * Submission ids are time-ordered ULIDs, so that difference is an
 * unauthenticated enumeration of who submitted when — precisely what the
 * not-found branch was written to prevent, defeated by the branch above it. A
 * clock outside the skew window produced the same split, for the same reason:
 * the reason string was chosen by whichever check happened to run first, and
 * which check ran first depended on the row.
 *
 * One rule instead, applied to both: a caller that has proved it holds a
 * configured key gets the diagnosis it needs, and everybody else gets one
 * fixed 401 that reveals nothing about whether the row is there.
 *
 * The diagnosis lost by that is `verifySignature`'s "you are still on the old
 * signature format", which only the right key can provoke and which now
 * reaches nobody here — proving key possession takes a *current*-format
 * signature. Nothing is actually lost: a runner reaches these two endpoints
 * only after claiming a job, and `POST /api/runner/jobs/request` still answers
 * that one verbatim, because it takes the backend id from its own body and so
 * has no row existence to give away.
 */
async function authorizeJob(
  request: Request,
  id: string,
  signed: SignedRequest,
): Promise<NextResponse | null> {
  const backendId = await backendOf(id);

  if (backendId) {
    const signature = verifyRunner(backendId, request, signed);
    if (signature.ok) return null;

    // Signed with somebody's key, just not this row's: an operator whose
    // runner is pointed at the wrong queue, and worth telling.
    const reason = signedByAnyBackend(request, signed)
      ? signature.reason
      : UNPROVEN;
    return NextResponse.json({ error: reason }, { status: 401 });
  }

  // A runner asking about a job this deployment has no row for is an
  // environment mismatch worth diagnosing — once it has shown it belongs here.
  return signedByAnyBackend(request, signed)
    ? NextResponse.json({ error: "提交不存在" }, { status: 404 })
    : NextResponse.json({ error: UNPROVEN }, { status: 401 });
}

/**
 * What to evaluate.
 *
 * Separate from the claim because the claim's shape then never has to change,
 * and because this is where the lease earns its keep: without a holder check
 * here, one compromised evaluator could walk the id space and read every
 * competitor's submission. That exposure is new with the pull model — under the
 * push model the kernel chose what to send and to whom — so it is closed at the
 * one endpoint that hands content out.
 *
 * The lease travels in the query string rather than a header because the
 * signature covers the path *and its search*, and covers no headers at all. A
 * GET has no body to put it in, so the query is the only place it is protected.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gated = guardRequest(request, "GET /api/runner/jobs/[id]");
  if (gated) return gated;

  const { id } = await params;
  const url = new URL(request.url);

  // The canonical pathname plus the search exactly as it arrived: a
  // prefix-stripping proxy rewrites the former and never the latter, which is
  // why only one of the two is reconstructed. See `jobPath`.
  const signed = { method: "GET", path: jobPath(id) + url.search, body: "" };

  const refused = await authorizeJob(request, id, signed);
  if (refused) return refused;

  const lease = url.searchParams.get("lease");
  const details = lease ? await jobDetails(id, lease) : null;

  // 409 rather than 404, and the distinction is what a runner acts on: the job
  // exists, it is simply not this caller's any more. Stop evaluating it — the
  // heartbeat lapsed, or an administrator rejudged it, and something else is
  // holding it now.
  if (!details) {
    return NextResponse.json(
      { error: "lease 已失效，这份提交不再由你持有" },
      { status: 409 },
    );
  }

  return NextResponse.json(details, {
    headers: { "cache-control": "no-store" },
  });
}

/**
 * The three things a holder can say: still here, here is the verdict, I cannot
 * do this.
 *
 * One endpoint because all three are the same act — the holder of a lease
 * reporting on it — and all three are refused the same way when the lease is no
 * longer current.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gated = guardRequest(request, "PUT /api/runner/jobs/[id]");
  if (gated) return gated;

  const { id } = await params;

  const read = await readTextBody(request, MAX_BODY_BYTES);
  if (!read.ok) {
    return NextResponse.json({ error: "上报内容过大" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = jobReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "上报格式不合法" }, { status: 400 });
  }

  const signed = {
    method: "PUT",
    path: jobPath(id) + new URL(request.url).search,
    body: read.text,
  };

  const refused = await authorizeJob(request, id, signed);
  if (refused) return refused;

  const report = parsed.data;
  const accepted =
    report.state === "alive"
      ? await reportAlive(id, report.lease, report.status)
      : report.state === "done"
        ? await reportDone(
            id,
            report.lease,
            report.verdict,
            report.backendVersion,
          )
        : await reportFailed(
            id,
            report.lease,
            report.reason,
            report.backendVersion,
          );

  // The same 409 the details endpoint gives, and it means the same thing: a
  // runner that gets this should drop the job rather than retry. Retrying is
  // what a 5xx invites, and a stale holder retrying forever is precisely the
  // loop the lease exists to cut.
  if (!accepted) {
    return NextResponse.json(
      { error: "lease 已失效，这次上报没有被采纳" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true });
}
