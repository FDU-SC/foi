import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { viewerFor } from "@/lib/auth/viewer";
import { isSettled } from "@/lib/backend/types";
import { rateLimit } from "@/lib/ratelimit";
import { guardRequest, tooManyRequests } from "@/lib/ratelimit/gate";
import { fixedRule, ROUTE_LIMITS } from "@/lib/ratelimit/policy";
import { submissionFor } from "@/lib/submissions/access";
import { toView } from "@/lib/submissions/queries";
import { locateOne } from "@/lib/submissions/queue-position";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gated = guardRequest(request, "GET /api/submissions/[id]");
  if (gated) return gated;

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  // This is the endpoint the client polls while a verdict is outstanding, and
  // every call runs a queue lookup on top of the row read. Bounded above what
  // a few tabs backing off from 800ms legitimately produce.
  const rule = fixedRule(ROUTE_LIMITS["GET /api/submissions/[id]"]);
  const limited = rateLimit(
    `submission:${user.handle}`,
    rule.max,
    rule.windowSeconds * 1000,
  );
  if (!limited.ok) return tooManyRequests(limited.retryAfterMs);

  const { id } = await params;
  const row = await submissionFor(id, viewerFor(user));
  if (!row) {
    return NextResponse.json({ error: "提交不存在" }, { status: 404 });
  }

  const view = toView(row);
  if (!isSettled(row.state)) {
    view.queue = await locateOne(row.id);
  }

  return NextResponse.json(view, {
    headers: { "cache-control": "no-store" },
  });
}
