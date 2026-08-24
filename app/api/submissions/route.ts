import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ulid } from "ulid";
import { getResolvedUser, getSessionUser } from "@/auth";
import { viewerFor } from "@/lib/auth/viewer";
import { readTextBody } from "@/lib/body-limit";
import { ensureContest } from "@/lib/contests/queries";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import {
  callbackUrl,
  createCallbackToken,
  dispatchToJudge,
  DispatchError,
  releaseSha,
  resolveBackend,
} from "@/lib/backend/client";
import { NON_TERMINAL_STATES } from "@/lib/backend/types";
import { ensureProblem } from "@/lib/problems/sync";
import { rateLimit } from "@/lib/ratelimit";
import { guardRequest, tooManyRequests } from "@/lib/ratelimit/gate";
import { fixedRule, ROUTE_LIMITS } from "@/lib/ratelimit/policy";
import { publish } from "@/lib/submissions/events";
import { submitFor, type SubmitGate } from "@/lib/submissions/gate";
import { createSubmissionSchema } from "@/lib/submissions/types";
import { submissionsFor } from "@/lib/submissions/access";
import { getSubmissionRow, toView } from "@/lib/submissions/queries";

export const runtime = "nodejs";

const MAX_PAYLOAD_BYTES = 512 * 1024;

/**
 * The floor under every account, whatever the round says.
 *
 * Not the same control as the per-problem throttle below, and the two are
 * separated on purpose. That one is a decision about how a competition runs,
 * so a contest states it; this one is a security parameter, so the kernel
 * keeps it — the same split `lib/auth/email-verification.ts` draws over its
 * attempt cap. Without it, declaring the throttle per problem would let one
 * account spend a full budget on every open problem at once, which is the
 * abuse the single global counter used to catch.
 *
 * Set well above anything a person does: it exists to stop one stolen account
 * saturating the judges, not to shape play. A round that wants a tighter
 * answer says so in `content/`.
 */
const FLOOD_CAP = { max: 60, windowMs: 60 * 1000 };

/** One shape for both refusals, so a client cannot tell which bound it hit. */
function tooFast(retryAfterMs: number): NextResponse {
  return NextResponse.json(
    { error: "提交过于频繁，请稍后再试" },
    {
      status: 429,
      headers: { "retry-after": String(Math.ceil(retryAfterMs / 1000)) },
    },
  );
}

/**
 * The gate's refusals in HTTP.
 *
 * Nothing but a mapping, and deliberately nothing but a mapping: which of these
 * a request earns is `submitFor`'s decision, and why they are three answers
 * rather than one is argued where that decision lives. Exhaustive over the
 * union, so widening the gate cannot leave a reason without a status.
 */
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

  // The resolved user, not the session one: entry rules key on cohort tags,
  // which are computed from the account rather than carried in the token.
  const user = await getResolvedUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const read = await readTextBody(request, MAX_PAYLOAD_BYTES);
  if (!read.ok) {
    return NextResponse.json({ error: "提交内容过大" }, { status: 413 });
  }
  const raw = read.text;

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

  // Ahead of every check that costs something: the mirror upsert and the
  // dispatch both write, and both happen before any response. The throttle the
  // round declared is applied further down, once there is a problem and a
  // contest to read it from — everything between here and there is a registry
  // lookup, so nothing has been spent by the time it runs.
  const flood = rateLimit(
    `submit:${user.handle}`,
    FLOOD_CAP.max,
    FLOOD_CAP.windowMs,
  );
  if (!flood.ok) return tooFast(flood.retryAfterMs);

  // Every rule about whether this submission may exist, in one call. The three
  // refusals are deliberately distinguishable and the reasons they get
  // different answers are documented on `SubmitGate`; all this handler does
  // with them is choose a status code.
  const gate = submitFor(
    parsed.data.problemSlug,
    parsed.data.contestSlug,
    user,
  );
  if (!gate.ok) return refuse(gate.reason);

  const { problem, contest: running } = gate;

  // Keyed by the same three things that chose the number, because a counter
  // shared across problems could not enforce a limit declared on one of them —
  // and a problem submitted to inside a round and outside it is two budgets,
  // since the round may have set a different one.
  //
  // Last gate before the first write: `ensureContest` below is the first
  // statement in this handler that touches the database.
  const limited = rateLimit(
    `submit:${user.handle}:${running?.slug ?? "-"}:${problem.slug}`,
    gate.rateLimit.max,
    gate.rateLimit.windowSeconds * 1000,
  );
  if (!limited.ok) return tooFast(limited.retryAfterMs);

  let contestSlug: string | null = null;
  if (running) {
    await ensureContest(running);
    contestSlug = running.slug;
  }

  let backend;
  try {
    backend = resolveBackend(problem.backend.id);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "评测机配置错误" },
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
      // Recorded at creation rather than at judging: this is the code that
      // decided which backend to dispatch to and what config to hand it, and
      // that decision is made here. The backend's own version arrives later,
      // with the verdict.
      releaseSha: releaseSha(),
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
      user: { handle: user.handle, groups: user.groups },
      problem: { slug: problem.slug, config: problem.backend.config },
      contestSlug,
      payload: parsed.data.payload,
      callbackUrl: callbackUrl(),
      callbackToken: token,
    });

    await settle({ state: "judging", judgeRef, dispatchedAt: new Date() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "投递题目后端失败";

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
  const gated = guardRequest(request, "GET /api/submissions");
  if (gated) return gated;

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  // Fifty rows joined and rendered per call, and nothing about the shape of
  // the request says how often it may be asked for.
  const rule = fixedRule(ROUTE_LIMITS["GET /api/submissions"]);
  const limited = rateLimit(
    `submissions:${user.handle}`,
    rule.max,
    rule.windowSeconds * 1000,
  );
  if (!limited.ok) return tooManyRequests(limited.retryAfterMs);

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
