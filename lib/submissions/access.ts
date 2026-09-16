import "server-only";
import { allows } from "@/lib/authz/engine";
import { rowScope } from "@/lib/authz/filter";
import type { Viewer } from "@/lib/authz/viewer";
import { isSettled } from "@/lib/backend/types";
import { readSnapshot } from "@/lib/db/read";
import type { SubmissionRow } from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { getSubmissionRow, getQueueInfo, listSubmissions, toView } from "./queries";
import { locateInQueues } from "./queue-position";
import type { SubmissionListItem, SubmissionView } from "./types";

export interface ReadSubmission {
  record: SubmissionRow;
  view: SubmissionView;
}

async function withPositions<T extends SubmissionView>(
  rows: T[],
  on: DbOrTx,
): Promise<T[]> {
  const pending = rows.filter((row) => !isSettled(row.state));
  if (pending.length === 0) return rows;
  const positions = await locateInQueues(pending.map((row) => row.id), on);
  return rows.map((row) => ({
    ...row,
    queue: isSettled(row.state) ? null : positions.get(row.id) ?? null,
  }));
}

function readSubmission(
  id: string,
  readable: (record: SubmissionRow) => boolean,
  signal?: AbortSignal,
): Promise<ReadSubmission | undefined> {
  return readSnapshot(async (tx) => {
    const record = await getSubmissionRow(id, tx);
    if (!record || !readable(record)) return undefined;
    const queue = record.state === "pending" ? await getQueueInfo(id, tx) : null;
    const [view] = await withPositions([toView(record, queue)], tx);
    return { record, view };
  }, signal);
}

export async function submissionFor(
  id: string,
  viewer: Viewer,
  signal?: AbortSignal,
): Promise<ReadSubmission | undefined> {
  return readSubmission(id, (record) => allows("submission.read", record, viewer), signal);
}

/** Creation acknowledges its author without adding a submission.read prerequisite. */
export async function createdSubmissionView(
  id: string,
  uid: number,
): Promise<SubmissionView> {
  const read = await readSubmission(id, (record) => record.uid === uid);
  if (!read) throw new Error("提交记录不存在");
  return read.view;
}

/**
 * The listing narrows on what the caller asked for, then intersects it with
 * what the viewer may see. Asking for someone else's uid is allowed to be a
 * no-op rather than an error: the scope decides what comes back.
 */
export function submissionsFor(
  viewer: Viewer,
  options?: {
    uid?: number;
    problemSlug?: string;
    contestSlug?: string;
    limit?: number;
  },
): Promise<SubmissionListItem[]> {
  const scope = rowScope("submission.read", viewer);
  if (scope.kind === "none") return Promise.resolve([]);

  return readSnapshot(async (tx) => {
    const rows = await listSubmissions({
      ...options,
      scope: scope.kind === "where" ? scope.sql : undefined,
    }, tx);
    return withPositions(rows, tx);
  });
}
