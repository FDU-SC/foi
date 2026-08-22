import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { fetchAllJudgeQueues, redactJudgeStatus } from "@/lib/judge/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const statuses = await fetchAllJudgeQueues();
  const visible =
    user.role === "admin" ? statuses : statuses.map(redactJudgeStatus);

  return NextResponse.json(visible, {
    headers: { "cache-control": "no-store" },
  });
}
