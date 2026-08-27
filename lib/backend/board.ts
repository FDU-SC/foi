import { and, asc, count, gte, inArray } from "drizzle-orm";
import type { Viewer } from "@/lib/permissions/viewer";
import { db } from "@/lib/db";
import { runners, submissions } from "@/lib/db/schema";
import { RUNNER_ONLINE_MS } from "@/lib/runner/queue";
import { backendsFor } from "./access";
import { backends, listBackendIds } from "./registry";

/**
 * What every backend's queue looks like right now, and how much of it a given
 * viewer may see.
 *
 * A database read throughout: the queue is held here, so nothing on this page
 * requires a backend to be reachable and nothing here makes a network call.
 */

/** One entry in a backend's queue, as the board draws it. */
export interface QueueEntry {
  submissionId: string;
  /**
   * Absent once redacted for non-admins: it would reveal which problem each
   * person is working on, mid-contest.
   */
  problemSlug?: string;
  state: "queued" | "judging";
  /**
   * The holder's own account of what it is doing, verbatim, or null. Opaque —
   * see `runnerStatusSchema`. Redacted alongside `runnerId`, because a problem
   * is perfectly capable of writing its own name into it.
   */
  status?: string | null;
  runnerId?: string | null;
  /**
   * When this row last entered the queue — `queued_at`, not `created_at`, so a
   * rejudged submission is drawn as the new arrival it is. It is also the key
   * the list is ordered on, which is what makes the board's order the order
   * work will actually be handed out in.
   */
  enqueuedAt: string;
  claimedAt?: string;
}

/**
 * What one backend's queue looks like right now.
 *
 * A database read rather than a report from the backend, so positions are
 * exact rather than a snapshot of whatever a judge said fifteen seconds ago,
 * and nothing has to be reachable to be shown.
 *
 * There is deliberately no health, capacity or latency here. Each would be a
 * backend describing itself over a link that has to be up for the description
 * to arrive, which makes the board's answer to "is this working" mostly an
 * answer about the network. `runners` — processes that have actually asked for
 * work lately — is the only fact an operator needs beside the queue depth to
 * tell a backlog apart from an outage.
 */
export interface BackendQueueStatus {
  id: string;
  /**
   * Where the kernel reaches this backend for interactive actions, or null —
   * both when the viewer may not see it and when the backend has none, which is
   * now the ordinary case. Judging needs no address at all.
   */
  url: string | null;
  runners: number;
  queued: number;
  judging: number;
  items: QueueEntry[];
}

/** Rows drawn per backend. A board, not an export. */
const BOARD_LIMIT = 50;

/**
 * Every configured backend's queue, from the database.
 *
 * Driven by the configuration rather than by what happens to be in the table,
 * so a backend with nothing queued still appears — as an idle one, which is
 * information.
 *
 * The depths and the listing are two statements because they are two
 * questions, and answering both from one truncated read gets the more
 * important one wrong. Take `BOARD_LIMIT * ids.length` rows ordered globally
 * and group them here, and it works right up until one backend is having the
 * bad day the board exists to show: its backlog fills the window, every other
 * backend's rows fall off the end, and their `queued` and `judging` come back
 * zero. The page then says nobody is waiting anywhere — the single reading an
 * operator must never be handed wrongly, since it is the one that ends the
 * investigation.
 *
 * So the counts are a `group by` over the whole in-flight set and are exact.
 * The listing keeps its cap and is honestly a window: a backend behind a deep
 * backlog may show a truncated list, or none of its own rows at all, while its
 * depth beside it stays right. That is the correct half to compromise — the
 * number is the diagnosis and the rows are the illustration.
 */
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
        runnerId: submissions.runnerId,
        runnerStatus: submissions.runnerStatus,
        queuedAt: submissions.queuedAt,
        claimedAt: submissions.claimedAt,
      })
      .from(submissions)
      .where(inFlight)
      // The order work is handed out in, so the board reads top to bottom as
      // the queue will drain. `queued_at` and not `created_at` for the reason
      // `claimJob` uses it: a rejudged submission is at the back, where it
      // joined, rather than at the front where it was first submitted.
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

/**
 * The queues this viewer may see, already redacted for them.
 *
 * Two decisions, both made here rather than at each call site: whether the
 * viewer may know a backend exists at all, and how much of its queue they may
 * read. The page and the API must not each answer them.
 */
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

/**
 * What a player is allowed to see of a queue they may see at all.
 *
 * Submission ids stay, so everyone can find their own entry and read their
 * position off the queue. Removed: the backend's address, which is
 * infrastructure detail that only widens the attack surface; other players'
 * problem choices, which leak who is working on what mid-contest; and the
 * runner's name and self-description, because both are strings a backend
 * author chose and neither is anything a competitor is owed.
 */
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
