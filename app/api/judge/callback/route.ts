import { timingSafeEqual } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import {
  callbackUrl,
  hashCallbackToken,
  resolveBackend,
} from "@/lib/backend/client";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifySignature,
} from "@/lib/backend/signature";
import {
  judgeCallbackSchema,
  isTerminalState,
  NON_TERMINAL_STATES,
} from "@/lib/backend/types";
import { readTextBody } from "@/lib/body-limit";
import { publish } from "@/lib/submissions/events";
import { toView } from "@/lib/submissions/queries";
import { verdictColumns } from "@/lib/submissions/verdict";
import { invalidateStandings } from "@/lib/standings/cache";

// Signature verification uses node:crypto, so this must not run on Edge.
export const runtime = "nodejs";

/**
 * Generous, because a verdict's `detail` carries whatever the backend wants to
 * show — a compile log, a diff, a per-test breakdown — and bounded anyway,
 * because this is the one route with no caller to hold responsible. Nothing
 * below this line runs until the body has fit.
 */
const MAX_BODY_BYTES = 1024 * 1024;

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
  const read = await readTextBody(request, MAX_BODY_BYTES);
  if (!read.ok) {
    return NextResponse.json({ error: "回调内容过大" }, { status: 413 });
  }
  const raw = read.text;

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = judgeCallbackSchema.safeParse(body);
  if (!parsed.success) {
    // Naming this one field rather than answering "格式不合法" in general. It
    // is the field every existing backend is missing the first time it meets a
    // kernel that requires it, and the generic message would send an operator
    // to inspect a body that is otherwise perfectly correct — the same reason
    // the signature check distinguishes "old format" from "does not match".
    const missingVersion = parsed.error.issues.some(
      (issue) => issue.path[0] === "backendVersion",
    );
    return NextResponse.json(
      {
        error: missingVersion
          ? "回调缺少 backendVersion：题目后端必须回报自身版本，请升级后端"
          : "回调格式不合法",
      },
      { status: 400 },
    );
  }

  const [row] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, parsed.data.submissionId))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "提交不存在" }, { status: 404 });
  }

  let backend;
  try {
    backend = resolveBackend(row.backendId);
  } catch {
    return NextResponse.json({ error: "题目后端配置错误" }, { status: 500 });
  }

  // Signed against the callback URL the kernel itself issued at dispatch, not
  // against the path this request arrived on. A reverse proxy that strips a
  // prefix — `location /foi/ { proxy_pass http://app/; }` — would otherwise
  // leave the backend signing one path and this route verifying another, and
  // every verdict would fail to land for a reason nothing in the logs explains.
  const signature = verifySignature({
    secret: backend.secret,
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
    request: {
      method: "PUT",
      path: new URL(callbackUrl()).pathname,
      body: raw,
    },
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

  // The envelope fields peel off here: what stays in `verdict` is the archived
  // copy of what the backend decided, with nothing of the kernel's own in it.
  const {
    submissionId: _id,
    callbackToken: _token,
    backendVersion,
    ...verdict
  } = parsed.data;

  // The state guard, not the check above, is what makes this safe: the
  // reconciler may reach a terminal state between that read and this write.
  const [updated] = await db
    .update(submissions)
    .set({
      state: "completed",
      verdict,
      backendVersion,
      ...verdictColumns(verdict, row.problemSlug),
      judgedAt: new Date(),
    })
    .where(
      and(
        eq(submissions.id, row.id),
        inArray(submissions.state, NON_TERMINAL_STATES),
      ),
    )
    .returning();

  if (!updated) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  publish(toView(updated));
  if (updated.contestSlug) invalidateStandings(updated.contestSlug);

  return NextResponse.json({ ok: true });
}
