import { allows } from "@/lib/authz/engine";
import { rowScope } from "@/lib/authz/filter";
import type { Viewer } from "@/lib/authz/viewer";
import type { SubmissionRow } from "@/lib/db/schema";
import { getSubmissionRow, listSubmissions } from "./queries";
import type { SubmissionListItem } from "./types";

export async function submissionFor(
  id: string,
  viewer: Viewer,
): Promise<SubmissionRow | undefined> {
  const row = await getSubmissionRow(id);
  if (!row) return undefined;

  return allows("submission.read", row, viewer) ? row : undefined;
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

  return listSubmissions({
    ...options,
    scope: scope.kind === "where" ? scope.sql : undefined,
  });
}
