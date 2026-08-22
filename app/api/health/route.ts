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
    return NextResponse.json(
      {
        ok: false,
        database: "down",
        error: error instanceof Error ? error.message : "unknown",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
