import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { userCan } from "@/lib/auth/session";
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
    userCan(user, "judge.inspect")
      ? statuses
      : statuses.map(redactJudgeStatus);

  return NextResponse.json(visible, {
    headers: { "cache-control": "no-store" },
  });
}
