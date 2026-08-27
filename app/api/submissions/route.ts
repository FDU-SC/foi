import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ulid } from "ulid";
import { getResolvedUser, getSessionUser } from "@/auth";
import type { DbOrTx } from "@/lib/accounts/queries";
import { viewerFor } from "@/lib/permissions/viewer";
import { readTextBody } from "@/lib/body-limit";
import { releaseSha } from "@/lib/boot/deployment";
import { db } from "@/lib/db";
import { ensureContest, ensureProblem } from "@/lib/db/mirror";
import { submissions } from "@/lib/db/schema";
import { resolveBackend, type ResolvedBackend } from "@/lib/backend/resolve";
import {
  INLINE_BACKEND_ID,
  INLINE_BACKEND_VERSION,
  NON_TERMINAL_STATES,
} from "@/lib/backend/types";
import {
  isInlineBackend,
  isInlineUnavailable,
  type InlineBackend,
} from "@/lib/problems/types";
import { invalidateStandings } from "@/lib/standings/cache";
import { verdictColumns } from "@/lib/submissions/verdict";
import { rateLimit } from "@/lib/ratelimit";
import { guardRequest, tooManyRequests } from "@/lib/ratelimit/gate";
import { alsoRule, fixedRule, ROUTE_LIMITS } from "@/lib/ratelimit/policy";
import { publish } from "@/lib/submissions/events";
import { submitFor, type SubmitGate } from "@/lib/submissions/gate";
import { createSubmissionSchema } from "@/lib/submissions/types";
import { submissionsFor } from "@/lib/submissions/access";
import { findSubmissionByNonce, toView } from "@/lib/submissions/queries";

export const runtime = "nodejs";

const MAX_PAYLOAD_BYTES = 512 * 1024;

/**
 * The floor under every account, whatever the round says.
 *
 * Read out of the table rather than written here. `test/enforcement.ts` cites
 * `ratelimit/policy.ts` as a load-bearing declaration rather than a document
 * precisely because handlers take their numbers from it, and a bound recorded
 * there and separately spelled out here is one that can drift while both
 * copies still look maintained. Why this floor exists at all, and why it sits
 * where a real person never reaches it, is argued with the entry.
 *
 * `alsoRule` throws when an entry has no second bound, and it is called at
 * import so that losing one is a startup failure rather than an endpoint
 * quietly running unmetered.
 */
const FLOOD_CAP = alsoRule(ROUTE_LIMITS["POST /api/submissions"]);

/**
 * One wording for both of this handler's bounds, so a client cannot tell which
 * one it hit. Everything else about a 429 — the status, the body shape, the
 * `retry-after` arithmetic — belongs to `tooManyRequests`.
 */
const TOO_FAST = "提交过于频繁，请稍后再试";

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
  // submission row both write, and both happen before any response. The
  // throttle the round declared is applied further down, once there is a
  // contest to read it from — everything between here and there is a registry
  // lookup or one indexed read, so nothing has been spent by the time it runs.
  const flood = rateLimit(
    `submit:${user.handle}`,
    FLOOD_CAP.max,
    FLOOD_CAP.windowSeconds * 1000,
  );
  if (!flood.ok) return tooManyRequests(flood.retryAfterMs, TOO_FAST);

  // Asked before the gate and before the round's throttle, because a replay is
  // not a new submission and none of those questions are being asked for the
  // first time. Running them again is how a reply lost on the way back turns
  // into a 429 — or a 404 for a round that has since closed — for a submission
  // that in fact succeeded. See `submissions.clientNonce`.
  const { clientNonce } = parsed.data;
  if (clientNonce) {
    const existing = await findSubmissionByNonce(user.handle, clientNonce);
    // 200 rather than the 201 below: this call created nothing. The body is
    // the same shape either way, so a client reading only `res.ok` cannot tell
    // — which is the point, since to the person clicking it is the same
    // submission.
    if (existing) return NextResponse.json(toView(existing));
  }

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
  // statement in this handler that changes anything.
  const limited = rateLimit(
    `submit:${user.handle}:${running?.slug ?? "-"}:${problem.slug}`,
    gate.rateLimit.max,
    gate.rateLimit.windowSeconds * 1000,
  );
  if (!limited.ok) return tooManyRequests(limited.retryAfterMs, TOO_FAST);

  let contestSlug: string | null = null;
  if (running) {
    await ensureContest(running);
    contestSlug = running.slug;
  }

  // Settled before the first write, so a problem naming a backend that is not
  // configured fails without leaving a row behind. Kept as a tagged value
  // rather than two nullable locals because the two paths diverge again below,
  // and a tag is what lets the compiler carry the choice across the early
  // return instead of each site asserting it again.
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

  const values = {
    id,
    handle: user.handle,
    problemSlug: problem.slug,
    contestSlug,
    payload: parsed.data.payload,
    clientNonce: clientNonce ?? null,
    backendId:
      judging.kind === "inline" ? INLINE_BACKEND_ID : judging.backend.id,
    maxScore: problem.maxScore,
    // Recorded at creation rather than at judging: this is the code that
    // decided which backend the row belongs to and what config a runner will
    // be handed, and that decision is made here. The backend's own version
    // arrives later, with the verdict.
    releaseSha: releaseSha(),
    state: "queued",
    // The first lap's clock. Equal to `created_at` here and only here — the
    // two part company the moment anything requeues the row, which is why the
    // fuse reads this one.
    queuedAt: new Date(),
  } satisfies typeof submissions.$inferInsert;

  /**
   * The insert *is* the enqueue. There is nothing after it for an external
   * problem: no outbound request, no acknowledgement to interpret, no window in
   * which the row exists here and might or might not exist there. A runner will
   * come and take it, or the fuse will burn through and say nobody did.
   *
   * The read above is not enough on its own: two clicks arriving together both
   * pass it, and only the index can decide between them. Targets the nonce
   * index alone, so a row carrying no nonce cannot conflict with anything —
   * Postgres holds no two nulls to be equal.
   *
   * Takes its executor instead of closing over `db` because the inline path
   * issues it inside a transaction, for the reason argued on `judgeInline`.
   */
  const enqueue = (on: DbOrTx) =>
    on
      .insert(submissions)
      .values(values)
      .onConflictDoNothing({
        target: [submissions.handle, submissions.clientNonce],
      })
      .returning();

  /**
   * What an inline judgement leaves on the row — one of three answers, all of
   * them terminal.
   *
   * A verdict settles as `completed`. A judge saying it cannot judge settles as
   * `disrupted`, which is where `reportFailed` puts a runner that says the same
   * thing, and for the same reason: there is no result, and the absence is not
   * the submitter's doing.
   *
   * A judge *throwing* lands in `disrupted` too, and the two being one state is
   * deliberate: a judge that threw is our code breaking, not the submission
   * being unacceptable, and charging that to the competitor is precisely the
   * mistake `disrupted` exists to stop. What separates the two is only the text
   * on the row — one is a judge naming a condition it was written to detect,
   * the other is a stack that got away.
   */
  const settlement = (
    backend: InlineBackend,
  ): Partial<typeof submissions.$inferInsert> => {
    try {
      const judgement = backend.judge({
        payload: parsed.data.payload,
        config: backend.config,
        user: { handle: user.handle, groups: user.groups },
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
        // The same total the insert above already wrote. An inline judge is the
        // registry's own code running against the registry's own config, so
        // "what this submission was scored out of" and "what the problem says
        // right now" cannot differ here — unlike on the runner path, where the
        // row may have outlived an edit.
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

  /**
   * Creates the row and settles it in one transaction, because in between the
   * two writes nothing owns it.
   *
   * As separate statements, a process dying in the gap leaves the row `queued`
   * under `backendId: 'inline'` — a place nothing in the system can move it out
   * of. `claimJob` selects by backend id and nothing signs as `inline`;
   * `rejudgeSubmissions` refuses inline rows outright; the only mechanism that
   * would ever touch it again is the queue fuse, six hours later. A submission
   * invisible to everything for a quarter of a day is worse than one that was
   * never written, and a transaction is what makes the second the only outcome.
   *
   * Holding one open across the judgement costs nothing to reason about:
   * `InlineJudge` is synchronous by type, so there is no await in here for the
   * connection to sit through — only however long the judgement computes,
   * which is a bound the request already lives under.
   *
   * `publish` and `invalidateStandings` stay outside on purpose. They announce
   * the row to the rest of the process, and announcing from inside would tell
   * everybody about a judgement a rollback could still take back.
   */
  const judgeInline = (backend: InlineBackend) =>
    db.transaction(async (tx) => {
      const [created] = await enqueue(tx);
      if (!created) return { created, settled: undefined };

      // The guard cannot fail on this path — the row was inserted by this very
      // transaction, and until it commits nothing outside can see the row, let
      // alone write to it. Kept because a write that states the invariant it
      // depends on is cheaper to keep right than one that relies on the
      // caller's reading of the surrounding code.
      const [settled] = await tx
        .update(submissions)
        .set(settlement(backend))
        .where(
          and(
            eq(submissions.id, id),
            inArray(submissions.state, NON_TERMINAL_STATES),
          ),
        )
        .returning();

      return { created, settled };
    });

  const { created, settled } =
    judging.kind === "inline"
      ? await judgeInline(judging.backend)
      : { created: (await enqueue(db))[0], settled: undefined };

  if (!created) {
    // Lost that race, so the winner's row is the answer — the same answer the
    // read above would have given had it run a moment later.
    const existing = clientNonce
      ? await findSubmissionByNonce(user.handle, clientNonce)
      : undefined;
    if (existing) return NextResponse.json(toView(existing));

    // Unreachable while the nonce index is the only conflict target: without a
    // nonce there is nothing to conflict on, and with one the row that won is
    // there to be read. Answered rather than left to throw, because the
    // alternative is reading fields off `created` being undefined.
    return NextResponse.json({ error: "提交失败，请重试" }, { status: 500 });
  }

  // A backend problem is finished with here — `settled` is the inline path's
  // alone. The row is `queued`, which is the whole of the kernel's involvement
  // until a runner asks for it.
  if (!settled) {
    return NextResponse.json(toView(created), { status: 201 });
  }

  // Judged inside this request: no queue, no runner, no reaper. The row went
  // from `queued` to a terminal state before anything else could look at it,
  // which is why an inline problem never appears on the queue board.
  const judged = toView(settled);
  publish(judged);

  // Only a verdict moves a board. A judgement that could not be reached leaves
  // the row in `disrupted`, which the standings do not count, so there is
  // nothing there to invalidate.
  if (contestSlug && settled.state === "completed") {
    invalidateStandings(contestSlug);
  }

  return NextResponse.json(judged, { status: 201 });
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
