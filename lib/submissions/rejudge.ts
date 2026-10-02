import { and, asc, eq, inArray } from "drizzle-orm";
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

  skippedByFilter: number;

  skippedInline: number;

  skippedNotDispatched: number;
}

/**
 * The backend judging this problem now. A runner is handed the problem's
 * current config, so a rejudge goes where that config belongs, not to the
 * backend the submission was first judged on.
 */
function currentBackend(problemSlug: string): string | undefined {
  const problem = problemBySlug(problemSlug);
  return problem && !isInlineBackend(problem.backend) ? problem.backend.id : undefined;
}

export type RejudgeSkipFilter = (row: {
  id: string;
  state: SubmissionRecordState;
  result: unknown;
}) => boolean;

export async function rejudgeSubmissions(
  ids: string[],
  options: { skipFilter?: RejudgeSkipFilter } = {},
): Promise<RejudgeResult> {
  const empty: RejudgeResult = {
    requeued: 0,
    skippedByFilter: 0,
    skippedInline: 0,
    skippedNotDispatched: 0,
  };
  if (ids.length === 0) return empty;

  const result = await db.transaction(async (tx) => {
  const rows = await tx
    .select()
    .from(submissions)
    .where(
      and(
        inArray(submissions.id, ids),
        inArray(submissions.state, TERMINAL_RECORD_STATES),
      ),
    )
    .orderBy(asc(submissions.id))
    .for("update");

  const inline = rows.filter((row) => row.backendId === INLINE_BACKEND_ID);
  const external = rows.filter((row) => row.backendId !== INLINE_BACKEND_ID);

  const notDispatched = external.filter(
    (row) => currentBackend(row.problemSlug) === undefined,
  );
  const strandedIds = new Set(notDispatched.map((row) => row.id));
  const routed = external.filter((row) => !strandedIds.has(row.id));

  const filtered = options.skipFilter
    ? routed.filter((row) => options.skipFilter!(row))
    : [];
  const filteredIds = new Set(filtered.map((row) => row.id));
  const targets = routed.filter((row) => !filteredIds.has(row.id));

  if (targets.length === 0) {
    return {
      requeued: 0,
      skippedByFilter: filtered.length,
      skippedInline: inline.length,
      skippedNotDispatched: notDispatched.length,
      contests: [],
    };
  }

  // The row's backend moves with the job: runner requests are verified against it.
  const requeued: (typeof submissions.$inferSelect)[] = [];
  for (const [backendId, group] of Map.groupBy(targets, (row) => currentBackend(row.problemSlug)!)) {
    requeued.push(...await tx
      .update(submissions)
      .set({
        state: "pending" satisfies SubmissionRecordState,
        backendId,
        result: null,
        detail: null,
        backendVersion: null,
        releaseSha: releaseSha(),
        error: null,
        judgedAt: null,
      })
      .where(inArray(submissions.id, group.map((row) => row.id)))
      .returning());
  }

  if (requeued.length > 0) {
    await tx.insert(judgingQueue).values(
      requeued.map((row) => ({
        submissionId: row.id,
        backendId: row.backendId,
        priority: REJUDGE_PRIORITY,
        state: "waiting" as const,
        attempts: 0,
        queuedAt: new Date(),
      })),
    );
  }

  const contests = new Set<string>();
  for (const row of requeued) {
    await publish(tx, row.id, { state: "queued" });
    contests.add(row.contestSlug);
  }

  return {
    requeued: requeued.length,
    skippedByFilter: filtered.length,
    skippedInline: inline.length,
    skippedNotDispatched: notDispatched.length,
    contests: [...contests],
  };
  });

  const { contests, ...counts } = result;
  for (const slug of contests) invalidateStandings(slug);
  return counts;
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

export async function submissionStateOf(id: string): Promise<
  | {
      id: string;
      uid: number;
      problemSlug: string;
      contestSlug: string;
      state: SubmissionRecordState;
      backendId: string;
    }
  | undefined
> {
  const [row] = await db
    .select({
      id: submissions.id,
      uid: submissions.uid,
      problemSlug: submissions.problemSlug,
      contestSlug: submissions.contestSlug,
      state: submissions.state,
      backendId: submissions.backendId,
    })
    .from(submissions)
    .where(eq(submissions.id, id))
    .limit(1);
  return row;
}
