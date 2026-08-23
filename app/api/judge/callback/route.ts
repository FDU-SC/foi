import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { hashCallbackToken, resolveJudge } from "@/lib/judge/client";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifySignature,
} from "@/lib/judge/signature";
import { judgeCallbackSchema, isTerminalState } from "@/lib/judge/types";
import { publish } from "@/lib/submissions/events";
import { toView } from "@/lib/submissions/queries";
import { invalidateStandings } from "@/lib/standings/cache";

// Signature verification uses node:crypto, so this must not run on Edge.
export const runtime = "nodejs";

function equalTokens(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Where judges report results.
 *
 * Unauthenticated writes here would let anyone hand themselves an AC, so every
 * request must carry a valid HMAC over `<timestamp>.<body>` *and* the one-time
 * token issued at dispatch. Repeat deliveries are accepted and ignored, since
 * judges retry when a callback times out.
 */
export async function PUT(request: Request) {
  const raw = await request.text();

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = judgeCallbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "回调格式不合法" }, { status: 400 });
  }

  const [row] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, parsed.data.submissionId))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "提交不存在" }, { status: 404 });
  }

  let judge;
  try {
    judge = resolveJudge(row.judgeId);
  } catch {
    return NextResponse.json({ error: "判题机配置错误" }, { status: 500 });
  }

  const signature = verifySignature({
    secret: judge.secret,
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
    body: raw,
  });
  if (!signature.ok) {
    return NextResponse.json({ error: signature.reason }, { status: 401 });
  }

  if (!equalTokens(hashCallbackToken(parsed.data.callbackToken), row.callbackTokenHash)) {
    return NextResponse.json({ error: "回调令牌无效" }, { status: 401 });
  }

  // Idempotent: the first terminal write wins, retries are acknowledged.
  if (isTerminalState(row.state)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const { status, score, maxScore, detail } = parsed.data;
  const [updated] = await db
    .update(submissions)
    .set({
      state: "completed",
      verdict: { status, score, maxScore, detail },
      score,
      maxScore,
      judgedAt: new Date(),
    })
    .where(eq(submissions.id, row.id))
    .returning();

  publish(toView(updated));
  if (updated.contestSlug) invalidateStandings(updated.contestSlug);

  return NextResponse.json({ ok: true });
}
