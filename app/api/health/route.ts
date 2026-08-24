import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sourceGate } from "@/lib/ratelimit/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness plus database reachability.
 *
 * Used by the compose healthcheck and by the deploy workflow to decide whether
 * a release came up cleanly, so it must not require authentication.
 *
 * Gated by source anyway, because it does touch the database and there is no
 * account to count against. That is safe for the probe rather than a risk to
 * it: the compose healthcheck curls localhost from inside the container, which
 * carries no forwarded header, so `sourceFrom` reports no source and the gate
 * stands aside. A 429 here would be read as an unhealthy container and get it
 * restarted, which is exactly the outcome that reasoning avoids.
 */
export async function GET(request: Request) {
  const gated = sourceGate(request, "GET /api/health");
  if (gated) return gated;

  try {
    await db.execute(sql`select 1`);
    return NextResponse.json(
      { ok: true, database: "up" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    // The reason goes to the log, not to the response. This endpoint is
    // unauthenticated by necessity, and a driver error carries the host, the
    // database name and sometimes the user it tried — enough to describe the
    // internals to anybody who can reach the URL. What a healthcheck needs is
    // the status code.
    console.error("[foi] 健康检查失败：数据库不可达", error);
    return NextResponse.json(
      { ok: false, database: "down" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
