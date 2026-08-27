import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ulid } from "ulid";
import { getResolvedUser, getSessionUser } from "@/auth";
import type { DbOrTx } from "@/lib/accounts/queries";
import { viewerFor } from "@/lib/permissions/viewer";
import { readJsonBody } from "@/lib/body-limit";
import { releaseSha } from "@/lib/boot/deployment";
import { db } from "@/lib/db";
import { judgingQueue, submissions } from "@/lib/db/schema";
import { ensureContest, ensureProblem } from "@/lib/db/mirror";
import { resolveBackend, type ResolvedBackend } from "@/lib/backend/resolve";
import {
  INLINE_BACKEND_ID,
  INLINE_BACKEND_VERSION,
} from "@/lib/backend/types";
import {
  isInlineBackend,
  isInlineUnavailable,
  type InlineBackend,
} from "@/lib/problems/types";
import { invalidateStandings } from "@/lib/standings/cache";
import { verdictColumns } from "@/lib/submissions/verdict";
import { rateLimit } from "@/lib/ratelimit";
import { guardRequest, tooManyRequests } from "@/lib/server/guard";
import { ROUTE_LIMITS } from "@/lib/ratelimit/policy";
import { publish } from "@/lib/submissions/events";
import { submitFor, type SubmitGate } from "@/lib/submissions/gate";
import { createSubmissionSchema } from "@/lib/submissions/types";
import { submissionsFor } from "@/lib/submissions/access";
import { findSubmissionByNonce, toView } from "@/lib/submissions/queries";

export const runtime = "nodejs";

const MAX_PAYLOAD_BYTES = 512 * 1024;

const FLOOD_CAP = ROUTE_LIMITS["POST /api/submissions"].also;

const TOO_FAST = "提交过于频繁，请稍后再试";

function refuse(reason: (SubmitGate & { ok: false })["reason"]): NextResponse {
  switch (reason) {
    case "no-problem":
      return NextResponse.json({ error: "题目不存在" }, { status: 404 });
    case "contest-mismatch":
      return NextResponse.json(
        { error: "该比赛未在进行中，或不包含这道题目" },
        { status: 400 },
      );
    case "not-entered":
      return NextResponse.json(
        { error: "你不在这场比赛的参赛名单中" },
        { status: 403 },
      );
  }
}

export async function POST(request: Request) {
  const gated = guardRequest(request, "POST /api/submissions");
  if (gated) return gated;

  const user = await getResolvedUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

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

  const flood = rateLimit(
    `submit:${user.uid}`,
    FLOOD_CAP.max,
    FLOOD_CAP.windowSeconds * 1000,
  );
  if (!flood.ok) return tooManyRequests(flood.retryAfterMs, TOO_FAST);

  const { clientNonce } = parsed.data;
  if (clientNonce) {
    const existing = await findSubmissionByNonce(user.uid, clientNonce);

    if (existing) return NextResponse.json(toView(existing));
  }

  const gate = submitFor(
    parsed.data.problemSlug,
    parsed.data.contestSlug,
    user,
  );
  if (!gate.ok) return refuse(gate.reason);

  const { problem, contest: running } = gate;

  const limited = rateLimit(
    `submit:${user.uid}:${running?.slug ?? "-"}:${problem.slug}`,
    gate.rateLimit.max,
    gate.rateLimit.windowSeconds * 1000,
  );
  if (!limited.ok) return tooManyRequests(limited.retryAfterMs, TOO_FAST);

  let contestSlug: string | null = null;
  if (running) {
    await ensureContest(running);
    contestSlug = running.slug;
  }

  let judging:
    | { kind: "inline"; backend: InlineBackend }
    | { kind: "external"; backend: ResolvedBackend };

  if (isInlineBackend(problem.backend)) {
    judging = { kind: "inline", backend: problem.backend };
  } else {
    try {
      judging = {
        kind: "external",
        backend: resolveBackend(problem.backend.id),
      };
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "评测机配置错误" },
        { status: 500 },
      );
    }
  }

  await ensureProblem(problem);

  const id = `sub_${ulid()}`;

  const submissionValues = {
    id,
    uid: user.uid,
    problemSlug: problem.slug,
    contestSlug,
    payload: parsed.data.payload,
    clientNonce: clientNonce ?? null,
    backendId:
      judging.kind === "inline" ? INLINE_BACKEND_ID : judging.backend.id,
    maxScore: problem.maxScore,
    releaseSha: releaseSha(),
    state: "pending" as const,
    createdAt: new Date(),
  } satisfies typeof submissions.$inferInsert;

  const settlement = (
    backend: InlineBackend,
  ): Partial<typeof submissions.$inferInsert> => {
    try {
      const judgement = backend.judge({
        payload: parsed.data.payload,
        config: backend.config,
        user: { uid: user.uid, groups: user.groups },
        contestSlug,
      });

      if (isInlineUnavailable(judgement)) {
        return {
          state: "disrupted",
          error: judgement.reason,
          judgedAt: new Date(),
        };
      }

      return {
        state: "completed",
        verdict: judgement,
        backendVersion: INLINE_BACKEND_VERSION,

        ...verdictColumns(judgement, problem.maxScore),
        judgedAt: new Date(),
      };
    } catch (error) {
      return {
        state: "disrupted",
        error: error instanceof Error ? error.message : "内联判题失败",
        judgedAt: new Date(),
      };
    }
  };

  const enqueue = (on: DbOrTx) =>
    on
      .insert(submissions)
      .values(submissionValues)
      .onConflictDoNothing({
        target: [submissions.uid, submissions.clientNonce],
      })
      .returning();

  if (judging.kind === "inline") {
    const result = await db.transaction(async (tx) => {
      const [created] = await enqueue(tx);
      if (!created) return { created: undefined };

      const patch = settlement(judging.backend);
      const [settled] = await tx
        .update(submissions)
        .set(patch)
        .where(eq(submissions.id, id))
        .returning();

      return { created: settled ?? created };
    });

    if (!result.created) {
      const existing = clientNonce
        ? await findSubmissionByNonce(user.uid, clientNonce)
        : undefined;
      if (existing) return NextResponse.json(toView(existing));
      return NextResponse.json({ error: "提交失败，请重试" }, { status: 500 });
    }

    const view = toView(result.created);

    if (result.created.state !== "pending") {
      await publish(db, id, { state: result.created.state });
      if (contestSlug && result.created.state === "completed") {
        invalidateStandings(contestSlug);
      }
    }

    return NextResponse.json(view, { status: 201 });
  }

  // External backend: insert submission + queue entry
  const created = await db.transaction(async (tx) => {
    const [row] = await enqueue(tx);
    if (!row) return undefined;

    await tx.insert(judgingQueue).values({
      submissionId: id,
      backendId: judging.backend.id,
      priority: contestSlug ? 1 : 0,
      state: "waiting",
      queuedAt: new Date(),
    });

    return row;
  });

  if (!created) {
    const existing = clientNonce
      ? await findSubmissionByNonce(user.uid, clientNonce)
      : undefined;
    if (existing) return NextResponse.json(toView(existing));
    return NextResponse.json({ error: "提交失败，请重试" }, { status: 500 });
  }

  return NextResponse.json(toView(created), { status: 201 });
}

export async function GET(request: Request) {
  const gated = guardRequest(request, "GET /api/submissions");
  if (gated) return gated;

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

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
