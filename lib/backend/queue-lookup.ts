import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { MAX_ATTEMPTS } from "@/lib/runner/queue";

export interface QueuePosition {
  backendId: string;
  state: "judging" | "queued";
  /** Submissions ahead in the queue; 0 once a runner has taken it. */
  ahead: number;
}

/**
 * Where the given submissions sit in their backends' queues.
 *
 * Exact now, which is the dividend of holding the queue here. It used to read
 * every backend's self-reported snapshot and match locally, so a position was
 * as fresh as the last poll, silently absent for a backend that truncated its
 * listing, and wrong for the whole interval after a judge dequeued something.
 *
 * Two statements, and the second reads whole queues rather than counting per
 * row. Counting in the database instead would mean a correlated subquery or a
 * window function written in raw SQL, and the column names in it would be a
 * rename waiting to break silently.
 *
 * Whole queues, but only the ones the first statement actually landed in. The
 * set of `queued` rows being small by construction — a runner takes the oldest
 * every second or two, so the queue is work that has arrived and not yet
 * started, not the history — is true of a deployment where every backend has
 * somebody serving it, and that is precisely the state in which nobody is
 * asking this question. A queue goes deep when its runners are down, and the
 * minutes it is deep are the minutes everyone whose submission is in it is
 * reloading the list to find out why. Naming the backends puts the leading
 * column of `submissions_queued_idx` in the predicate, so each queue is a seek
 * into that index instead of a scan across every backend's share of it.
 */
export async function locateInQueues(
  submissionIds: string[],
): Promise<Map<string, QueuePosition>> {
  const found = new Map<string, QueuePosition>();
  if (submissionIds.length === 0) return found;

  const wanted = await db
    .select({
      id: submissions.id,
      backendId: submissions.backendId,
      state: submissions.state,
      queuedAt: submissions.queuedAt,
    })
    .from(submissions)
    .where(
      and(
        inArray(submissions.id, submissionIds),
        inArray(submissions.state, ["queued", "judging"]),
      ),
    );

  if (wanted.length === 0) return found;

  // The same set `claimJob` picks from, predicate for predicate. Rows at the
  // attempt cap are deliberately left `queued` for the reaper to write off, so
  // for up to one tick they sit in the table looking like work — and counting
  // them told whoever was behind them that somebody was in front who was never
  // going to be handed to anybody. An exact position is the whole dividend of
  // holding the queue here; a position that counts phantoms is the snapshot
  // this replaced, with better latency.
  const backendIds = [...new Set(wanted.map((row) => row.backendId))];

  const queued = await db
    .select({
      backendId: submissions.backendId,
      queuedAt: submissions.queuedAt,
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.state, "queued"),
        inArray(submissions.backendId, backendIds),
        lt(submissions.attempts, MAX_ATTEMPTS),
      ),
    );

  // How many rows are ahead of a given instant on a given backend. By
  // `queued_at` and not `created_at`, because that is the order `claimJob`
  // hands work out in — the position is a fact about that ordering rather than
  // a display convention, and the two columns disagree for exactly the rows a
  // rejudge or a requeue has put back.
  const aheadOf = (backendId: string, queuedAt: Date): number =>
    queued.filter(
      (row) =>
        row.backendId === backendId &&
        row.queuedAt.getTime() < queuedAt.getTime(),
    ).length;

  for (const row of wanted) {
    found.set(row.id, {
      backendId: row.backendId,
      state: row.state === "judging" ? "judging" : "queued",
      // A row somebody is already holding has nothing ahead of it, whatever the
      // queue behind it looks like.
      ahead: row.state === "judging" ? 0 : aheadOf(row.backendId, row.queuedAt),
    });
  }

  return found;
}

export async function locateOne(
  submissionId: string,
): Promise<QueuePosition | null> {
  const found = await locateInQueues([submissionId]);
  return found.get(submissionId) ?? null;
}
