import type { Viewer } from "@/lib/permissions/viewer";
import type { SubmissionRow } from "@/lib/db/schema";
import { getSubmissionRow, listSubmissions } from "./queries";
import type { SubmissionListItem } from "./types";

/**
 * How anything that renders to a person obtains a submission.
 *
 * The same shape as the problem, contest and judge gates, and here for a
 * sharper reason than any of them: this is where the leak actually happened.
 * The rule — yours, or you hold `submission.readAny` — was written out three
 * times identically, in the detail route, the SSE stream and the detail page,
 * and the list endpoint was the fourth place that needed it and the one place
 * that did not have it, so `GET /api/submissions` handed any player the whole
 * site's verdicts. Three correct copies of a rule are not evidence the rule is
 * safe; they are the reason the fourth is missed.
 *
 * Scope is derived from the viewer and cannot be widened by an argument. A
 * caller may narrow — one problem, one contest, one person — but asking for
 * somebody else's submissions without the capability returns your own, not
 * theirs.
 */

/**
 * One submission, or `undefined` when it does not exist or is not this
 * viewer's to read. The two are deliberately indistinguishable — submission
 * ids are sequential-ish ULIDs, and telling somebody an id is real but not
 * theirs is a slow enumeration of who submitted when.
 */
export async function submissionFor(
  id: string,
  viewer: Viewer,
): Promise<SubmissionRow | undefined> {
  const row = await getSubmissionRow(id);
  if (!row) return undefined;

  const mayRead =
    viewer.can("submission.readAny") || row.handle === viewer.handle;
  return mayRead ? row : undefined;
}

/**
 * The submissions this viewer may list.
 *
 * `handle` narrows within what they may already see; it never widens. Without
 * `submission.readAny` it is ignored in favour of the viewer's own handle.
 */
export function submissionsFor(
  viewer: Viewer,
  options?: {
    handle?: string;
    problemSlug?: string;
    contestSlug?: string;
    limit?: number;
  },
): Promise<SubmissionListItem[]> {
  if (viewer.can("submission.readAny")) return listSubmissions({ ...options });

  // Nobody signed in means nothing to show. Returned without a query rather
  // than scoped to a handle that cannot match: a sentinel would be a value the
  // database has to understand, and the first one tried — a NUL byte — was
  // rejected by Postgres outright.
  if (!viewer.handle) return Promise.resolve([]);

  return listSubmissions({ ...options, handle: viewer.handle });
}
