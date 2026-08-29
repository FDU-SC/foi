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
import { problemBySlug } from "@/lib/problems/registry";
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
  if (!user) return apiDeny(UNAUTHENTICATED);
  const viewer = viewerFor(user);

  const { slug, action } = await params;

  const problem = problemBySlug(slug);
  if (!problem) {
    return NextResponse.json({ error: "题目不存在" }, { status: 404 });
  }

  // Naming a contest is a claim about attribution, and a claim that does not
  // hold is refused rather than quietly dropped — otherwise an interaction the
  // client believed counted for a round would run as practice.
  const requested = request.headers.get("x-foi-contest");
  const round = requested ? contestEntryFor(requested, slug, viewer) : null;
  if (round && !round.ok) return apiDeny(round.denial);

  const contest = round?.contest ?? null;

  const decision = authorize("problem.invoke", problem, viewer, {
    contest,
    invocation: action,
  });
  if (!decision.allow) return apiDeny(decision);

  const resolved = declaredAction(problem, action);
  if (!resolved) {
    return NextResponse.json({ error: "题目不存在" }, { status: 404 });
  }

  const verdict = rateLimit(
    `action:${user.uid}:${slug}:${action}`,
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
      problem: { slug: problem.slug, config: problem.backend.config },
      contestSlug: contest?.slug ?? null,
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
