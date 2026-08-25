import { gte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runners } from "@/lib/db/schema";
import { guardRequest } from "@/lib/ratelimit/gate";
import { reaperHealth } from "@/lib/runner/reaper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How recently a runner must have asked for work to be counted as here. */
const RUNNER_ONLINE_MS = 60_000;

/**
 * Liveness, database reachability, whether the reaper is running, and how many
 * runners are out there.
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
  const gated = guardRequest(request, "GET /api/health");
  if (gated) return gated;

  try {
    await db.execute(sql`select 1`);

    // Reported, not failed on. A stopped reaper means a runner that dies takes
    // its jobs with it — serious, but not a reason to restart a container that
    // is otherwise serving a contest, and a healthcheck that takes the site
    // down to fix a background loop has made things worse. The status code
    // stays with "can this process serve requests".
    const reaper = reaperHealth();

    // Zero is not a fault and is deliberately not reported as one: a deployment
    // between rounds legitimately has nobody running a runner, and a probe that
    // failed on it would restart a perfectly healthy container. It is here
    // because it is the number an operator wants when submissions are not
    // moving, and the one thing no other check can infer.
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
