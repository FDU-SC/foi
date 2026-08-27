import { NextResponse } from "next/server";
import { getResolvedUser } from "@/auth";
import { viewerFor } from "@/lib/permissions/viewer";
import { callBackendAction } from "@/lib/backend/client";
import { resolveBackend } from "@/lib/backend/resolve";
import { readJsonBody } from "@/lib/body-limit";
import { contestEntryFor } from "@/lib/contests/access";
import { actionFor } from "@/lib/problems/actions";
import { rateLimit } from "@/lib/ratelimit";
import { guardRequest, tooManyRequests } from "@/lib/ratelimit/gate";

// Signing uses node:crypto, so this must not run on Edge.
export const runtime = "nodejs";

const MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * The one way a statement reaches its problem's backend.
 *
 * Everything a problem needs beyond judging goes through here: handing out a
 * container, tearing one down, reporting whether it is up yet. The kernel
 * relays and does not interpret — `action` is a string the problem declared,
 * `payload` and the response are as opaque as a verdict's `detail`.
 *
 * The browser cannot call the backend itself, for the reason judging already
 * could not: the shared secret must not leave the server. That the control
 * plane is then reachable only from here is the point — a backend can sit on a
 * private network and still be driven from a public statement.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/problems/[slug]/action/[action]">,
) {
  const gated = guardRequest(request, "POST /api/problems/[slug]/action/[action]");
  if (gated) return gated;

  // The resolved user, not the session one: entry rules key on group
  // membership, which is computed from the account rather than carried in the
  // token.
  const user = await getResolvedUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const viewer = viewerFor(user);

  const { slug, action } = await params;

  // Every refusal this gate makes answers 404, so there is nothing to branch
  // on here; the reasons are documented where the decision is made.
  const resolved = actionFor(slug, action, viewer);
  if (!resolved) {
    return NextResponse.json({ error: "题目不存在" }, { status: 404 });
  }
  const problem = resolved.problem;

  // Keyed per action, not per problem: see `actionRateLimitSchema`.
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

  // Re-derived rather than trusted, by the same function the submission gate
  // and the statement page use: a client naming a contest is asking for
  // something the page never offered unless every fact behind it holds.
  //
  // Sent as a header rather than in the body so the body stays entirely the
  // problem's to define. Null when the round cannot be honoured for any
  // reason — a backend keying quotas or container lifetimes on a round must not
  // be told a round the player is not in, so both refusals collapse here.
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

  // The body is the problem's to define; the content type is not. It has been
  // narrowed to something a browser will not render as a document, and
  // `nosniff` stops one being inferred anyway — without both, a backend
  // answering `text/html` would have the kernel serve it from this origin.
  return new NextResponse(response.body, {
    status: response.status,
    headers: {
      "content-type": response.contentType,
      "x-content-type-options": "nosniff",
    },
  });
}
