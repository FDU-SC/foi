import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { UNAUTHENTICATED } from "@/lib/authz/adapters";
import { authorize } from "@/lib/authz/engine";
import { apiDeny } from "@/lib/authz/http";
import { viewerFor } from "@/lib/authz/viewer";
import { judgeQueuesFor } from "@/lib/backend/board";
import { rateLimit } from "@/lib/ratelimit";
import { guardRequest, tooManyRequests } from "@/lib/server/guard";
import { ROUTE_LIMITS } from "@/lib/ratelimit/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gated = guardRequest(request, "GET /api/judges/status");
  if (gated) return gated;

  const user = await getSessionUser();
  if (!user) return apiDeny(UNAUTHENTICATED);

  const viewer = viewerFor(user);
  const decision = authorize("judge.readBoard", null, viewer);
  if (!decision.allow) return apiDeny(decision);

  const rule = ROUTE_LIMITS["GET /api/judges/status"];
  const limited = rateLimit(
    `judges:${user.uid}`,
    rule.max,
    rule.windowSeconds * 1000,
  );
  if (!limited.ok) return tooManyRequests(limited.retryAfterMs);

  return NextResponse.json(await judgeQueuesFor(viewer), {
    headers: { "cache-control": "no-store" },
  });
}
