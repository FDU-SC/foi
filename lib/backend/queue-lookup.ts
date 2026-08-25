import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";

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
 * Two statements, and the second reads the entire queue rather than counting
 * per row. That is deliberate: the set of `queued` rows is small by
 * construction — a runner takes the oldest every second or two, so the queue is
 * work that has arrived and not yet started, not the history — and it is
 * exactly the set the partial index covers. Counting in the database instead
 * would mean a correlated subquery or a window function written in raw SQL, and
 * the column names in it would be a rename waiting to break silently.
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
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .where(
      and(
        inArray(submissions.id, submissionIds),
        inArray(submissions.state, ["queued", "judging"]),
      ),
    );

  if (wanted.length === 0) return found;

  const queued = await db
    .select({
      backendId: submissions.backendId,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .where(eq(submissions.state, "queued"));

  // How many rows are ahead of a given instant on a given backend. Oldest
  // first, because that is the order `claimJob` hands work out in — the
  // position is a fact about that ordering rather than a display convention.
  const aheadOf = (backendId: string, createdAt: Date): number =>
    queued.filter(
      (row) =>
        row.backendId === backendId && row.createdAt.getTime() < createdAt.getTime(),
    ).length;

  for (const row of wanted) {
    found.set(row.id, {
      backendId: row.backendId,
      state: row.state === "judging" ? "judging" : "queued",
      // A row somebody is already holding has nothing ahead of it, whatever the
      // queue behind it looks like.
      ahead:
        row.state === "judging" ? 0 : aheadOf(row.backendId, row.createdAt),
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
