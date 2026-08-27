import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
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
