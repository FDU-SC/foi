import { and, asc, count, gte, inArray } from "drizzle-orm";
import { allows } from "@/lib/authz/engine";
import type { Viewer } from "@/lib/authz/viewer";
import { db } from "@/lib/db";
import { judgingQueue, runners } from "@/lib/db/schema";
import { RUNNER_ONLINE_MS } from "@/lib/runner/queue";
import { backendsFor } from "./access";
import { backends, listBackendIds } from "./registry";

export interface QueueEntry {
  submissionId: string;

  problemSlug?: string;
  state: "queued" | "judging";

  status?: string | null;
  runnerId?: string | null;

  enqueuedAt: string;
  claimedAt?: string;
}

export interface BackendQueueStatus {
  id: string;

  url: string | null;
  runners: number;
  queued: number;
  judging: number;
  items: QueueEntry[];
}

const BOARD_LIMIT = 50;

async function allBackendQueues(): Promise<BackendQueueStatus[]> {
  const ids = listBackendIds();
  if (ids.length === 0) return [];

  const since = new Date(Date.now() - RUNNER_ONLINE_MS);

  const [depths, rows, online] = await Promise.all([
    db
      .select({
        backendId: judgingQueue.backendId,
        state: judgingQueue.state,
        count: count(),
      })
      .from(judgingQueue)
      .where(inArray(judgingQueue.backendId, ids))
      .groupBy(judgingQueue.backendId, judgingQueue.state),
    db
      .select({
        submissionId: judgingQueue.submissionId,
        backendId: judgingQueue.backendId,
        state: judgingQueue.state,
        runnerId: judgingQueue.runnerId,
        runnerStatus: judgingQueue.runnerStatus,
        queuedAt: judgingQueue.queuedAt,
        claimedAt: judgingQueue.claimedAt,
      })
      .from(judgingQueue)
      .where(inArray(judgingQueue.backendId, ids))
      .orderBy(asc(judgingQueue.queuedAt))
      .limit(BOARD_LIMIT * ids.length),
    db
      .select({ backendId: runners.backendId, count: count() })
      .from(runners)
      .where(
        and(inArray(runners.backendId, ids), gte(runners.lastSeenAt, since)),
      )
      .groupBy(runners.backendId),
  ]);

  const depthOf = new Map(
    depths.map((row) => [`${row.backendId}:${row.state}`, row.count]),
  );
  const runnersById = new Map(online.map((row) => [row.backendId, row.count]));

  return ids.map((id) => ({
    id,
    url: backends[id]?.url ?? null,
    runners: runnersById.get(id) ?? 0,
    queued: depthOf.get(`${id}:waiting`) ?? 0,
    judging: depthOf.get(`${id}:claimed`) ?? 0,
    items: rows
      .filter((row) => row.backendId === id)
      .slice(0, BOARD_LIMIT)
      .map((row) => ({
        submissionId: row.submissionId,
        state: row.state === "claimed" ? "judging" : "queued",
        status: row.runnerStatus,
        runnerId: row.runnerId,
        enqueuedAt: row.queuedAt.toISOString(),
        claimedAt: row.claimedAt?.toISOString(),
      })),
  }));
}

export async function judgeQueuesFor(
  viewer: Viewer,
): Promise<BackendQueueStatus[]> {
  const allowed = new Set(backendsFor(viewer));

  return (await allBackendQueues())
    .filter((status) => allowed.has(status.id))
    .map((status) =>
      allows("backend.inspect", { id: status.id }, viewer)
        ? status
        : redactJudgeStatus(status),
    );
}

export function redactJudgeStatus(
  status: BackendQueueStatus,
): BackendQueueStatus {
  return {
    ...status,
    url: null,
    items: status.items.map(
      ({
        problemSlug: _problemSlug,
        status: _status,
        runnerId: _runnerId,
        ...rest
      }) => rest,
    ),
  };
}
