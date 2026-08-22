import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ulid } from "ulid";
import { getSessionUser } from "@/auth";
import {
  contestHasProblem,
  contestPhase,
  getContestById,
} from "@/lib/contests/queries";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import {
  callbackUrl,
  createCallbackToken,
  dispatchToJudge,
  resolveJudge,
} from "@/lib/judge/client";
import { getProblem } from "@/lib/problems/registry";
import { ensureProblem } from "@/lib/problems/sync";
import { publish } from "@/lib/submissions/events";
import { createSubmissionSchema } from "@/lib/submissions/types";
import { listSubmissions, toView } from "@/lib/submissions/queries";

export const runtime = "nodejs";

const MAX_PAYLOAD_BYTES = 512 * 1024;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const raw = await request.text();
  if (raw.length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: "提交内容过大" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = createSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "请求参数不合法" }, { status: 400 });
  }

  const problem = getProblem(parsed.data.problemSlug);
  if (!problem) {
    return NextResponse.json({ error: "题目不存在" }, { status: 404 });
  }

  // The client supplies contestId, so re-derive whether it is legitimate:
  // the contest must be running and must actually contain this problem.
  let contestId: string | null = null;
  if (parsed.data.contestId) {
    const contest = await getContestById(parsed.data.contestId);
    const eligible =
      contest !== undefined &&
      contestPhase(contest) === "running" &&
      (await contestHasProblem(contest.id, problem.slug));
    if (!eligible) {
      return NextResponse.json(
        { error: "该比赛未在进行中，或不包含这道题目" },
        { status: 400 },
      );
    }
    contestId = contest.id;
  }

  let judge;
  try {
    judge = resolveJudge(problem.judge.id);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "判题机配置错误" },
      { status: 500 },
    );
  }

  await ensureProblem(problem);

  const id = `sub_${ulid()}`;
  const { token, hash } = createCallbackToken();

  // Persisted before dispatch so a judge that never acknowledges still leaves
  // a record the reconciler and the user can see.
  await db
    .insert(submissions)
    .values({
      id,
      userId: user.id,
      problemSlug: problem.slug,
      contestId,
      payload: parsed.data.payload,
      judgeId: judge.id,
      callbackTokenHash: hash,
      maxScore: problem.maxScore,
      state: "pending",
    });

  try {
    const { judgeRef } = await dispatchToJudge(judge, {
      submissionId: id,
      problem: { slug: problem.slug, config: problem.judge.config },
      payload: parsed.data.payload,
      callbackUrl: callbackUrl(),
      callbackToken: token,
    });

    const [updated] = await db
      .update(submissions)
      .set({ state: "judging", judgeRef, dispatchedAt: new Date() })
      .where(eq(submissions.id, id))
      .returning();

    publish(toView(updated));
    return NextResponse.json(toView(updated), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "投递判题机失败";
    const [failed] = await db
      .update(submissions)
      .set({ state: "failed", error: message, judgedAt: new Date() })
      .where(eq(submissions.id, id))
      .returning();

    publish(toView(failed));
    return NextResponse.json(toView(failed), { status: 201 });
  }
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  return NextResponse.json(
    await listSubmissions({
      userId: searchParams.get("mine") === "1" ? user.id : undefined,
      problemSlug: searchParams.get("problem") ?? undefined,
      contestId: searchParams.get("contest") ?? undefined,
      limit: 50,
    }),
  );
}
