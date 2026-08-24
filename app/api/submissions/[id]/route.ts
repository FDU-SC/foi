import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { viewerFor } from "@/lib/auth/viewer";
import { isTerminalState } from "@/lib/judge/types";
import { locateOne } from "@/lib/judge/queue-lookup";
import { submissionFor } from "@/lib/submissions/access";
import { toView } from "@/lib/submissions/queries";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { id } = await params;
  const row = await submissionFor(id, viewerFor(user));
  if (!row) {
    return NextResponse.json({ error: "提交不存在" }, { status: 404 });
  }

  const view = toView(row);
  if (!isTerminalState(row.state)) {
    view.queue = await locateOne(row.id);
  }

  return NextResponse.json(view, {
    headers: { "cache-control": "no-store" },
  });
}
