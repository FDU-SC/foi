import { and, eq, inArray, ne, sql } from "drizzle-orm";
import {
  INLINE_BACKEND_ID,
  TERMINAL_RECORD_STATES,
  type SubmissionRecordState,
} from "@/lib/backend/types";
import { releaseSha } from "@/lib/boot/deployment";
import { db } from "@/lib/db";
import { judgingQueue, submissions } from "@/lib/db/schema";
import { problemBySlug } from "@/lib/problems/registry";
import { isInlineBackend } from "@/lib/problems/types";
import { invalidateStandings } from "@/lib/standings/cache";
import { publish } from "@/lib/submissions/events";

export const REJUDGE_PRIORITY = -1;

export interface RejudgeResult {

  requeued: number;

  keptAccepted: number;

  skippedInline: number;

  skippedNotDispatched: number;
}

function stillDispatched(problemSlug: string): boolean {
  const problem = problemBySlug(problemSlug);
  return problem !== undefined && !isInlineBackend(problem.backend);
}

export async function rejudgeSubmissions(
  ids: string[],
  options: { includeAccepted?: boolean } = {},
): Promise<RejudgeResult> {
  const empty: RejudgeResult = {
    requeued: 0,
    keptAccepted: 0,
    skippedInline: 0,
    skippedNotDispatched: 0,
  };
  if (ids.length === 0) return empty;

  const rows = await db
    .select()
    .from(submissions)
    .where(
      and(
        inArray(submissions.id, ids),
        inArray(submissions.state, TERMINAL_RECORD_STATES),
      ),
    );

  const inline = rows.filter((row) => row.backendId === INLINE_BACKEND_ID);
  const external = rows.filter((row) => row.backendId !== INLINE_BACKEND_ID);

  const notDispatched = external.filter(
    (row) => !stillDispatched(row.problemSlug),
  );
  const strandedIds = new Set(notDispatched.map((row) => row.id));
  const routed = external.filter((row) => !strandedIds.has(row.id));

  const accepted = options.includeAccepted
    ? []
    : routed.filter((row) => {
        const r = row.result as { accepted?: boolean } | null;
        return row.state === "completed" && r?.accepted === true;
      });
  const acceptedIds = new Set(accepted.map((row) => row.id));
  const targets = routed.filter((row) => !acceptedIds.has(row.id));

  if (targets.length === 0) {
    return {
      requeued: 0,
      keptAccepted: accepted.length,
      skippedInline: inline.length,
      skippedNotDispatched: notDispatched.length,
    };
  }

  const targetIds = targets.map((row) => row.id);

  const requeued = await db
    .update(submissions)
    .set({
      state: "pending" satisfies SubmissionRecordState,
      result: null,
      detail: null,
      backendVersion: null,
      releaseSha: releaseSha(),
      error: null,
      judgedAt: null,
    })
    .where(
      and(
        inArray(submissions.id, targetIds),
        inArray(submissions.state, TERMINAL_RECORD_STATES),
        ne(submissions.backendId, INLINE_BACKEND_ID),
      ),
    )
    .returning();

  if (requeued.length > 0) {
    await db.insert(judgingQueue).values(
      requeued.map((row) => ({
        submissionId: row.id,
        backendId: row.backendId,
        priority: REJUDGE_PRIORITY,
        state: "waiting" as const,
        attempts: 0,
        queuedAt: new Date(),
      })),
    ).onConflictDoNothing();
  }

  const contests = new Set<string>();
  for (const row of requeued) {
    await publish(db, row.id, { state: "queued" });
    if (row.contestSlug) contests.add(row.contestSlug);
  }

  for (const slug of contests) invalidateStandings(slug);

  return {
    requeued: requeued.length,
    keptAccepted: accepted.length,
    skippedInline: inline.length,
    skippedNotDispatched: notDispatched.length,
  };
}

export function isRejudgeable(row: {
  state: SubmissionRecordState;
  backendId: string;
}): boolean {
  return (
    TERMINAL_RECORD_STATES.includes(row.state) &&
    row.backendId !== INLINE_BACKEND_ID
  );
}

export async function submissionStateOf(
  id: string,
): Promise<{ state: SubmissionRecordState; backendId: string } | undefined> {
  const [row] = await db
    .select({ state: submissions.state, backendId: submissions.backendId })
    .from(submissions)
    .where(eq(submissions.id, id))
    .limit(1);
  return row;
}
