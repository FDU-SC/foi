import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { viewerFor } from "@/lib/auth/viewer";
import { judgeQueuesFor } from "@/lib/judge/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  // Which judges, and how much of each, are one question answered in one
  // place — the route no longer decides either.
  return NextResponse.json(await judgeQueuesFor(viewerFor(user)), {
    headers: { "cache-control": "no-store" },
  });
}
