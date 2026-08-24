import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness plus database reachability.
 *
 * Used by the compose healthcheck and by the deploy workflow to decide whether
 * a release came up cleanly, so it must not require authentication.
 */
export async function GET() {
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
