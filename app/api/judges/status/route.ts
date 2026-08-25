import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { viewerFor } from "@/lib/auth/viewer";
import { judgeQueuesFor } from "@/lib/backend/client";
import { rateLimit } from "@/lib/ratelimit";
import { guardRequest, tooManyRequests } from "@/lib/ratelimit/gate";
import { fixedRule, ROUTE_LIMITS } from "@/lib/ratelimit/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gated = guardRequest(request, "GET /api/judges/status");
  if (gated) return gated;

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  // Nothing goes outbound here any more: the queue is the kernel's, so this is
  // two indexed reads against our own database rather than a fan-out to every
  // backend. What the bound is for is the work per poll on this side — a
  // session read, those queries and a render — since the board polls.
  const rule = fixedRule(ROUTE_LIMITS["GET /api/judges/status"]);
  const limited = rateLimit(
    `judges:${user.handle}`,
    rule.max,
    rule.windowSeconds * 1000,
  );
  if (!limited.ok) return tooManyRequests(limited.retryAfterMs);

  // Which judges, and how much of each, are one question answered in one
  // place — the route no longer decides either.
  return NextResponse.json(await judgeQueuesFor(viewerFor(user)), {
    headers: { "cache-control": "no-store" },
  });
}
