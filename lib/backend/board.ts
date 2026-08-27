import { and, asc, count, eq, gte, inArray } from "drizzle-orm";
import type { Viewer } from "@/lib/permissions/viewer";
import { db } from "@/lib/db";
import { judgingSessions, runners, submissions } from "@/lib/db/schema";
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

  const inFlight = and(
    inArray(submissions.backendId, ids),
    inArray(submissions.state, ["queued", "judging"]),
  );

  const since = new Date(Date.now() - RUNNER_ONLINE_MS);

  const [depths, rows, online] = await Promise.all([
    db
      .select({
        backendId: submissions.backendId,
        state: submissions.state,
        count: count(),
      })
      .from(submissions)
      .where(inFlight)
      .groupBy(submissions.backendId, submissions.state),
    db
      .select({
        id: submissions.id,
        backendId: submissions.backendId,
        problemSlug: submissions.problemSlug,
        state: submissions.state,
        runnerId: judgingSessions.runnerId,
        runnerStatus: judgingSessions.runnerStatus,
        queuedAt: submissions.queuedAt,
        claimedAt: judgingSessions.claimedAt,
      })
      .from(submissions)
      .leftJoin(
        judgingSessions,
        eq(judgingSessions.submissionId, submissions.id),
      )
      .where(inFlight)
      .orderBy(asc(submissions.queuedAt))
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
    queued: depthOf.get(`${id}:queued`) ?? 0,
    judging: depthOf.get(`${id}:judging`) ?? 0,
    items: rows
      .filter((row) => row.backendId === id)
      .slice(0, BOARD_LIMIT)
      .map((row) => ({
        submissionId: row.id,
        problemSlug: row.problemSlug,
        state: row.state === "judging" ? "judging" : "queued",
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
  const statuses = (await allBackendQueues()).filter((status) =>
    allowed.has(status.id),
  );

  return viewer.can("backend.inspect")
    ? statuses
    : statuses.map(redactJudgeStatus);
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
