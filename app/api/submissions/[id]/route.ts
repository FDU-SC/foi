import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { denialFor } from "@/lib/authz/actions";
import { denied, UNAUTHENTICATED } from "@/lib/authz/adapters";
import { apiDeny } from "@/lib/authz/http";
import { viewerFor } from "@/lib/authz/viewer";
import { rateLimit } from "@/lib/ratelimit";
import { guardRequest, tooManyRequests } from "@/lib/server/guard";
import { ROUTE_LIMITS } from "@/lib/ratelimit/policy";
import { submissionFor } from "@/lib/submissions/access";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gated = guardRequest(request, "GET /api/submissions/[id]");
  if (gated) return gated;

  const user = await getSessionUser();
  if (!user) return apiDeny(UNAUTHENTICATED);

  const rule = ROUTE_LIMITS["GET /api/submissions/[id]"];
  const limited = rateLimit(
    `submission:${user.uid}`,
    rule.max,
    rule.windowSeconds * 1000,
  );
  if (!limited.ok) return tooManyRequests(limited.retryAfterMs);

  const { id } = await params;
  const row = await submissionFor(id, viewerFor(user), request.signal);
  if (!row) return apiDeny(denied(denialFor("submission.read")));

  return NextResponse.json(row.view, {
    headers: { "cache-control": "no-store" },
  });
}
