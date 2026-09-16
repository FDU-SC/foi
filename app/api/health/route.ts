import { gte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runners } from "@/lib/db/schema";
import { log } from "@/lib/log";
import { guardRequest } from "@/lib/server/guard";
import { RUNNER_ONLINE_MS } from "@/lib/runner/queue";
import { reaperHealth } from "@/lib/runner/reaper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gated = guardRequest(request, "GET /api/health");
  if (gated) return gated;

  try {
    await db.execute(sql`select 1`);

    const reaper = reaperHealth();

    const [online] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(runners)
      .where(gte(runners.lastSeenAt, new Date(Date.now() - RUNNER_ONLINE_MS)));

    return NextResponse.json(
      {
        ok: true,
        database: "up",
        reaper: reaper.ok ? "up" : "stalled",
        reapedAt: reaper.ranAt?.toISOString() ?? null,
        runners: online?.count ?? 0,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {

    log.error("健康检查失败：数据库不可达", error);
    return NextResponse.json(
      { ok: false, database: "down" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
