import { NextResponse } from "next/server";
import { getResolvedUser, getSessionUser } from "@/auth";
import { UNAUTHENTICATED } from "@/lib/authz/adapters";
import { apiDeny } from "@/lib/authz/http";
import { viewerFor } from "@/lib/authz/viewer";
import { readJsonBody } from "@/lib/body-limit";
import { rateLimit } from "@/lib/ratelimit";
import { guardRequest, tooManyRequests } from "@/lib/server/guard";
import { ROUTE_LIMITS } from "@/lib/ratelimit/policy";
import { createSubmission } from "@/lib/submissions/create";
import { createSubmissionSchema } from "@/lib/submissions/types";
import { submissionsFor } from "@/lib/submissions/access";

export const runtime = "nodejs";

const MAX_PAYLOAD_BYTES = 512 * 1024;

const TOO_FAST = "提交过于频繁，请稍后再试";

export async function POST(request: Request) {
  const gated = guardRequest(request, "POST /api/submissions");
  if (gated) return gated;

  const user = await getResolvedUser();
  if (!user) return apiDeny(UNAUTHENTICATED);

  const read = await readJsonBody(request, MAX_PAYLOAD_BYTES);
  if (!read.ok) {
    switch (read.reason) {
      case "too-large":
        return NextResponse.json({ error: "提交内容过大" }, { status: 413 });
      case "invalid-json":
        return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
    }
  }
  const { body } = read;

  const parsed = createSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "请求参数不合法" }, { status: 400 });
  }

  const result = await createSubmission(parsed.data, user);
  switch (result.kind) {
    case "created":
    case "existing":
      return NextResponse.json(result.submission, {
        status: result.kind === "created" ? 201 : 200,
      });
    case "denied":
      return apiDeny(result.denial);
    case "limited":
      return tooManyRequests(result.retryAfterMs, TOO_FAST);
    case "configuration-error":
    case "failed":
      return NextResponse.json({ error: result.error }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const gated = guardRequest(request, "GET /api/submissions");
  if (gated) return gated;

  const user = await getSessionUser();
  if (!user) return apiDeny(UNAUTHENTICATED);

  const rule = ROUTE_LIMITS["GET /api/submissions"];
  const limited = rateLimit(
    `submissions:${user.uid}`,
    rule.max,
    rule.windowSeconds * 1000,
  );
  if (!limited.ok) return tooManyRequests(limited.retryAfterMs);

  const { searchParams } = new URL(request.url);
  const uidParam = searchParams.get("uid");

  return NextResponse.json(
    await submissionsFor(viewerFor(user), {
      uid: uidParam ? parseInt(uidParam, 10) : undefined,
      problemSlug: searchParams.get("problem") ?? undefined,
      contestSlug: searchParams.get("contest") ?? undefined,
      limit: 50,
    }),
  );
}
