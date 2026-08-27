import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { judgingQueue } from "@/lib/db/schema";
import { MAX_ATTEMPTS } from "@/lib/runner/queue";

export interface QueuePosition {
  backendId: string;
  state: "judging" | "queued";

  ahead: number;
}

export async function locateInQueues(
  submissionIds: string[],
): Promise<Map<string, QueuePosition>> {
  const found = new Map<string, QueuePosition>();
  if (submissionIds.length === 0) return found;

  const wanted = await db
    .select({
      submissionId: judgingQueue.submissionId,
      backendId: judgingQueue.backendId,
      state: judgingQueue.state,
      queuedAt: judgingQueue.queuedAt,
    })
    .from(judgingQueue)
    .where(inArray(judgingQueue.submissionId, submissionIds));

  if (wanted.length === 0) return found;

  const backendIds = [...new Set(wanted.map((row) => row.backendId))];

  const queued = await db
    .select({
      backendId: judgingQueue.backendId,
      queuedAt: judgingQueue.queuedAt,
    })
    .from(judgingQueue)
    .where(
      and(
        eq(judgingQueue.state, "waiting"),
        inArray(judgingQueue.backendId, backendIds),
        lt(judgingQueue.attempts, MAX_ATTEMPTS),
      ),
    );

  const aheadOf = (backendId: string, queuedAt: Date): number =>
    queued.filter(
      (row) =>
        row.backendId === backendId &&
        row.queuedAt.getTime() < queuedAt.getTime(),
    ).length;

  for (const row of wanted) {
    found.set(row.submissionId, {
      backendId: row.backendId,
      state: row.state === "claimed" ? "judging" : "queued",

      ahead: row.state === "claimed" ? 0 : aheadOf(row.backendId, row.queuedAt),
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
