import { NextResponse } from "next/server";
import { getResolvedUser } from "@/auth";
import { UNAUTHENTICATED } from "@/lib/authz/adapters";
import { authorize } from "@/lib/authz/engine";
import { apiDeny } from "@/lib/authz/http";
import { viewerFor } from "@/lib/authz/viewer";
import { callBackendAction } from "@/lib/backend/client";
import { resolveBackend } from "@/lib/backend/resolve";
import { readJsonBody } from "@/lib/body-limit";
import { contestEntryFor } from "@/lib/contests/access";
import { declaredAction } from "@/lib/problems/actions";
import { rateLimit } from "@/lib/ratelimit";
import { guardRequest, tooManyRequests } from "@/lib/server/guard";

export const runtime = "nodejs";

const MAX_PAYLOAD_BYTES = 64 * 1024;

const ROUTE = "POST /api/contests/[slug]/problems/[problem]/action/[action]";

export async function POST(
  request: Request,
  {
    params,
  }: RouteContext<"/api/contests/[slug]/problems/[problem]/action/[action]">,
) {
  const gated = guardRequest(request, ROUTE);
  if (gated) return gated;

  const user = await getResolvedUser();
  if (!user) return apiDeny(UNAUTHENTICATED);
  const viewer = viewerFor(user);

  const { slug, problem: problemSlug, action } = await params;

  const round = contestEntryFor(slug, problemSlug, viewer);
  if (!round.ok) return apiDeny(round.denial);

  const { ref } = round;

  const decision = authorize("problem.invoke", ref, viewer, {
    invocation: action,
  });
  if (!decision.allow) return apiDeny(decision);

  const resolved = declaredAction(ref.problem, action);
  if (!resolved) {
    return NextResponse.json({ error: "题目不存在" }, { status: 404 });
  }

  const verdict = rateLimit(
    `action:${user.uid}:${slug}:${problemSlug}:${action}`,
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

  let response;
  try {
    const backend = resolveBackend(resolved.backendId);
    response = await callBackendAction(backend, {
      action,
      user: { uid: user.uid, groups: user.groups },
      problem: { slug: ref.problem.slug, config: ref.problem.backend.config },
      contestSlug: ref.contest.slug,
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
