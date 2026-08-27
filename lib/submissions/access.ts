import type { Viewer } from "@/lib/permissions/viewer";
import type { SubmissionRow } from "@/lib/db/schema";
import { getSubmissionRow, listSubmissions } from "./queries";
import type { SubmissionListItem } from "./types";

export async function submissionFor(
  id: string,
  viewer: Viewer,
): Promise<SubmissionRow | undefined> {
  const row = await getSubmissionRow(id);
  if (!row) return undefined;

  const mayRead =
    viewer.can("submission.readAny") || row.uid === viewer.uid;
  return mayRead ? row : undefined;
}

export function submissionsFor(
  viewer: Viewer,
  options?: {
    uid?: number;
    problemSlug?: string;
    contestSlug?: string;
    limit?: number;
  },
): Promise<SubmissionListItem[]> {
  if (viewer.can("submission.readAny")) return listSubmissions({ ...options });

  if (!viewer.uid) return Promise.resolve([]);

  return listSubmissions({ ...options, uid: viewer.uid });
}
