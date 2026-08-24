import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ulid } from "ulid";
import { getResolvedUser, getSessionUser } from "@/auth";
import { viewerFor } from "@/lib/auth/viewer";
import { contestFor } from "@/lib/contests/access";
import { canEnterContest, ensureContest } from "@/lib/contests/queries";
import { contestPhase } from "@/lib/contests/types";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import {
  callbackUrl,
  createCallbackToken,
  dispatchToJudge,
  DispatchError,
  resolveBackend,
} from "@/lib/backend/client";
import { NON_TERMINAL_STATES } from "@/lib/backend/types";
import { problemFor } from "@/lib/problems/access";
import { ensureProblem } from "@/lib/problems/sync";
import { publish } from "@/lib/submissions/events";
import { createSubmissionSchema } from "@/lib/submissions/types";
import { submissionsFor } from "@/lib/submissions/access";
import { getSubmissionRow, toView } from "@/lib/submissions/queries";

export const runtime = "nodejs";

const MAX_PAYLOAD_BYTES = 512 * 1024;

export async function POST(request: Request) {
  // The resolved user, not the session one: entry rules key on cohort tags,
  // which are computed from the account rather than carried in the token.
  const user = await getResolvedUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const viewer = viewerFor(user);

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

  // This person's own view, then `gate.visible` on top of it. Two conditions,
  // because they rule out different people: the first stops somebody
  // submitting to a problem that is not theirs to see, the second stops a
  // holder of `problem.viewAll` submitting to one that is not open yet —
  // proofreading a round should not put work on its judges.
  //
  // Asking `AS_PLAYER` instead, as this once did, collapses the two and gets
  // the first one wrong: a problem given to 校队 has no audience under a viewer
  // with no groups, so the members it was written for could read it and not
  // submit to it.
  const open = problemFor(parsed.data.problemSlug, viewer);
  if (!open?.gate.visible) {
    return NextResponse.json({ error: "题目不存在" }, { status: 404 });
  }
  const problem = open.config;

  // The client supplies contestSlug, so re-derive whether it is legitimate:
  // the contest must be running and must actually contain this problem. Both
  // facts come from the registry, so this no longer costs a query.
  let contestSlug: string | null = null;
  if (parsed.data.contestSlug) {
    // Same shape as the problem above: their own view, plus `gate.visible` so
    // that seeing a contest by way of `contest.viewAll` is reading it rather
    // than competing in it.
    const view = contestFor(parsed.data.contestSlug, viewer);
    const contest = view?.gate.visible ? view.config : undefined;
    const eligible =
      contest !== undefined &&
      contestPhase(contest) === "running" &&
      contest.problems.some((entry) => entry.slug === problem.slug);
    if (!eligible) {
      return NextResponse.json(
        { error: "该比赛未在进行中，或不包含这道题目" },
        { status: 400 },
      );
    }

    // Separate from the check above because the answer is different: the
    // contest is real and running, this person just is not in it. Without
    // this, a closed contest's entry rule only decided who appeared on the
    // board while anyone could still queue work on its judges.
    if (!canEnterContest(contest, user)) {
      return NextResponse.json(
        { error: "你不在这场比赛的参赛名单中" },
        { status: 403 },
      );
    }

    await ensureContest(contest);
    contestSlug = contest.slug;
  }

  let backend;
  try {
    backend = resolveBackend(problem.backend.id);
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
  const [created] = await db
    .insert(submissions)
    .values({
      id,
      handle: user.handle,
      problemSlug: problem.slug,
      contestSlug,
      payload: parsed.data.payload,
      backendId: backend.id,
      callbackTokenHash: hash,
      maxScore: problem.maxScore,
      state: "pending",
    })
    .returning();

  /**
   * Applies a post-dispatch state change without clobbering a verdict.
   *
   * Every write below races the callback: a fast judge can finish before the
   * dispatch call even returns. The guard makes the callback win, and the
   * re-read makes the response tell the truth about who did.
   */
  const settle = async (
    patch: Partial<typeof submissions.$inferInsert>,
  ): Promise<void> => {
    const [updated] = await db
      .update(submissions)
      .set(patch)
      .where(
        and(
          eq(submissions.id, id),
          inArray(submissions.state, NON_TERMINAL_STATES),
        ),
      )
      .returning();

    publish(toView(updated ?? (await getSubmissionRow(id)) ?? created));
  };

  try {
    const { judgeRef } = await dispatchToJudge(backend, {
      submissionId: id,
      problem: { slug: problem.slug, config: problem.backend.config },
      payload: parsed.data.payload,
      callbackUrl: callbackUrl(),
      callbackToken: token,
    });

    await settle({ state: "judging", judgeRef, dispatchedAt: new Date() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "投递判题机失败";

    // Only an outright refusal is terminal. When the outcome is unknown the
    // row stays `pending`: the judge may have queued it anyway, and the
    // reconciler will either find the verdict or give up after ten minutes.
    // Recording the error either way leaves the reason visible in the UI.
    const rejected =
      error instanceof DispatchError && error.kind === "rejected";

    await settle(
      rejected
        ? { state: "failed", error: message, judgedAt: new Date() }
        : { error: message },
    );
  }

  const view = toView((await getSubmissionRow(id)) ?? created);
  return NextResponse.json(view, { status: 201 });
}

/**
 * Lists submissions, scoped to what the caller is allowed to read.
 *
 * The scope is derived from the capability, never from a query parameter.
 * Letting `?mine=` decide would hand every player a live feed of everyone
 * else's verdicts, which also defeats the freeze: a frozen scoreboard stops
 * rendering results, but this endpoint would still answer for them.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  // `handle` narrows, never widens: without `submission.readAny` the accessor
  // ignores it and answers for the caller instead.
  return NextResponse.json(
    await submissionsFor(viewerFor(user), {
      handle: searchParams.get("handle") ?? undefined,
      problemSlug: searchParams.get("problem") ?? undefined,
      contestSlug: searchParams.get("contest") ?? undefined,
      limit: 50,
    }),
  );
}
