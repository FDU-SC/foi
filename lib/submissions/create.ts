import "server-only";
import { eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { ResolvedUser } from "@/lib/accounts/types";
import type { Denial } from "@/lib/authz/adapters";
import { viewerFor } from "@/lib/authz/viewer";
import { resolveBackend, type ResolvedBackend } from "@/lib/backend/resolve";
import { INLINE_BACKEND_ID, INLINE_BACKEND_VERSION, verdictSchema } from "@/lib/backend/types";
import { releaseSha } from "@/lib/boot/deployment";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { ensureContest, ensureProblem } from "@/lib/db/mirror";
import { judgingQueue, submissions } from "@/lib/db/schema";
import { isInlineBackend, isInlineUnavailable, type InlineBackend } from "@/lib/problems/types";
import { rateLimit } from "@/lib/ratelimit";
import { ROUTE_LIMITS } from "@/lib/ratelimit/policy";
import { invalidateStandings } from "@/lib/standings/cache";
import { publish } from "./events";
import { submitFor } from "./gate";
import { findSubmissionByNonce } from "./queries";
import { createdSubmissionView } from "./access";
import type { CreateSubmission, SubmissionView } from "./types";

export type CreateSubmissionResult =
  | { kind: "created" | "existing"; submission: SubmissionView }
  | { kind: "denied"; denial: Denial }
  | { kind: "limited"; retryAfterMs: number }
  | { kind: "configuration-error" | "failed"; error: string };

async function acknowledge(
  kind: "created" | "existing",
  id: string,
  uid: number,
): Promise<CreateSubmissionResult> {
  try {
    return { kind, submission: await createdSubmissionView(id, uid) };
  } catch (error) {
    log.error(`提交 ${id} 读取失败`, error);
    return { kind: "failed", error: "提交读取失败，请重试" };
  }
}

function settleInline(
  backend: InlineBackend,
  input: CreateSubmission,
  user: ResolvedUser,
): Partial<typeof submissions.$inferInsert> {
  try {
    const judgement = backend.judge({
      payload: input.payload,
      config: backend.config,
      user: { uid: user.uid, groups: user.groups },
      contestSlug: input.contestSlug,
    });
    if (isInlineUnavailable(judgement)) {
      return { state: "disrupted", error: judgement.reason, judgedAt: new Date() };
    }
    const verdict = verdictSchema.parse(judgement);
    return {
      state: "completed",
      result: verdict.result,
      detail: verdict.detail ?? null,
      backendVersion: INLINE_BACKEND_VERSION,
      judgedAt: new Date(),
    };
  } catch (error) {
    return {
      state: "disrupted",
      error: error instanceof Error ? error.message : "内联判题失败",
      judgedAt: new Date(),
    };
  }
}

export async function createSubmission(
  input: CreateSubmission,
  user: ResolvedUser,
): Promise<CreateSubmissionResult> {
  const cap = ROUTE_LIMITS["POST /api/submissions"].also;
  const flood = rateLimit(`submit:${user.uid}`, cap);
  if (!flood.ok) return { kind: "limited", retryAfterMs: flood.retryAfterMs };

  const { clientNonce } = input;
  if (clientNonce) {
    const existing = await findSubmissionByNonce(user.uid, clientNonce);
    if (existing) return acknowledge("existing", existing.id, user.uid);
  }

  const gate = submitFor(input.contestSlug, input.problemSlug, viewerFor(user));
  if (!gate.ok) return { kind: "denied", denial: gate.denial };
  const { contest, problem } = gate.ref;
  const limited = rateLimit(
    `submit:${user.uid}:${contest.slug}:${problem.slug}`,
    gate.rateLimit,
  );
  if (!limited.ok) return { kind: "limited", retryAfterMs: limited.retryAfterMs };

  await ensureContest(contest);
  let judging:
    | { kind: "inline"; backend: InlineBackend }
    | { kind: "external"; backend: ResolvedBackend };
  if (isInlineBackend(problem.backend)) {
    judging = { kind: "inline", backend: problem.backend };
  } else {
    try {
      judging = { kind: "external", backend: resolveBackend(problem.backend.id) };
    } catch (error) {
      return {
        kind: "configuration-error",
        error: error instanceof Error ? error.message : "评测机配置错误",
      };
    }
  }
  await ensureProblem(problem);

  const id = `sub_${ulid()}`;
  const created = await db.transaction(async (tx) => {
    const [row] = await tx.insert(submissions).values({
      id,
      uid: user.uid,
      problemSlug: problem.slug,
      contestSlug: contest.slug,
      payload: input.payload,
      clientNonce: clientNonce ?? null,
      backendId: judging.kind === "inline" ? INLINE_BACKEND_ID : judging.backend.id,
      releaseSha: releaseSha(),
      state: "pending",
      createdAt: new Date(),
    }).onConflictDoNothing({
      target: [submissions.uid, submissions.clientNonce],
      where: sql`${submissions.clientNonce} is not null`,
    }).returning();
    if (!row) return undefined;

    if (judging.kind === "external") {
      await tx.insert(judgingQueue).values({
        submissionId: id,
        backendId: judging.backend.id,
        priority: 1,
        state: "waiting",
        queuedAt: new Date(),
      });
      return row;
    }

    const [settled] = await tx.update(submissions)
      .set(settleInline(judging.backend, input, user))
      .where(eq(submissions.id, id))
      .returning();
    const result = settled ?? row;
    if (result.state !== "pending") {
      await publish(tx, id, { state: result.state });
    }
    return result;
  });

  if (!created) {
    const existing = clientNonce
      ? await findSubmissionByNonce(user.uid, clientNonce)
      : undefined;
    return existing
      ? acknowledge("existing", existing.id, user.uid)
      : { kind: "failed", error: "提交失败，请重试" };
  }
  if (created.state === "completed") invalidateStandings(contest.slug);
  return acknowledge("created", created.id, user.uid);
}
