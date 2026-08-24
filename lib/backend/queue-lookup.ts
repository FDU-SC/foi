import { fetchAllJudgeQueues } from "./client";

export interface QueuePosition {
  backendId: string;
  state: "running" | "pending";
  /** Submissions ahead in the queue; 0 once evaluation has started. */
  ahead: number;
}

/**
 * Finds where the given submissions sit in their judges' queues.
 *
 * Queues live inside the judges, so this reads all of them once and matches
 * locally rather than issuing a request per submission. A judge that truncates
 * or omits `items` simply yields no position, and callers fall back to showing
 * the plain "queued" state.
 */
export async function locateInQueues(
  submissionIds: string[],
): Promise<Map<string, QueuePosition>> {
  const found = new Map<string, QueuePosition>();
  if (submissionIds.length === 0) return found;

  const wanted = new Set(submissionIds);
  const statuses = await fetchAllJudgeQueues();

  for (const status of statuses) {
    if (!status.queue) continue;

    const pending = status.queue.items
      .filter((item) => item.state === "pending")
      .sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));

    for (const item of status.queue.items) {
      if (!wanted.has(item.submissionId)) continue;

      found.set(item.submissionId, {
        backendId: status.id,
        state: item.state,
        ahead:
          item.state === "running"
            ? 0
            : Math.max(
                0,
                pending.findIndex(
                  (candidate) => candidate.submissionId === item.submissionId,
                ),
              ),
      });
    }
  }

  return found;
}

export async function locateOne(
  submissionId: string,
): Promise<QueuePosition | null> {
  const found = await locateInQueues([submissionId]);
  return found.get(submissionId) ?? null;
}
