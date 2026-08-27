import { NextResponse } from "next/server";
import { getResolvedUser } from "@/auth";
import { viewerFor } from "@/lib/permissions/viewer";
import { callBackendAction } from "@/lib/backend/client";
import { resolveBackend } from "@/lib/backend/resolve";
import { readJsonBody } from "@/lib/body-limit";
import { contestEntryFor } from "@/lib/contests/access";
import { actionFor } from "@/lib/problems/actions";
import { rateLimit } from "@/lib/ratelimit";
import { guardRequest, tooManyRequests } from "@/lib/server/guard";

export const runtime = "nodejs";

const MAX_PAYLOAD_BYTES = 64 * 1024;

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/problems/[slug]/action/[action]">,
) {
  const gated = guardRequest(request, "POST /api/problems/[slug]/action/[action]");
  if (gated) return gated;

  const user = await getResolvedUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const viewer = viewerFor(user);

  const { slug, action } = await params;

  const resolved = actionFor(slug, action, viewer);
  if (!resolved) {
    return NextResponse.json({ error: "题目不存在" }, { status: 404 });
  }
  const problem = resolved.problem;

  const verdict = rateLimit(
    `action:${user.handle}:${slug}:${action}`,
    resolved.rateLimit.max,
    resolved.rateLimit.windowSeconds * 1000,
  );
  if (!verdict.ok) {
    return tooManyRequests(verdict.retryAfterMs, "操作过于频繁，请稍后再试");
  }

  const read = await readJsonBody(request, MAX_PAYLOAD_BYTES);
  if (!read.ok) {
    switch (read.reason) {
      case "too-large":
        return NextResponse.json({ error: "请求内容过大" }, { status: 413 });
      case "invalid-json":
        return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
    }
  }
  const payload = read.body;

  const requested = request.headers.get("x-foi-contest");
  const round = requested
    ? contestEntryFor(requested, problem.slug, user)
    : null;
  const contestSlug = round?.ok ? round.contest.slug : null;

  let response;
  try {
    const backend = resolveBackend(resolved.backendId);
    response = await callBackendAction(backend, {
      action,
      user: { handle: user.handle, groups: user.groups },
      problem: { slug: problem.slug, config: problem.backend.config },
      contestSlug,
      payload,
    });
  } catch (error) {
    console.error("[foi] 题目后端配置错误，无法发起交互动作", error);
    return NextResponse.json({ error: "题目后端配置错误" }, { status: 500 });
  }

  return new NextResponse(response.body, {
    status: response.status,
    headers: {
      "content-type": response.contentType,
      "x-content-type-options": "nosniff",
    },
  });
}
