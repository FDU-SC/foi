import type { Verdict } from "@/lib/backend/types";
import { viewsFor } from "@/lib/problems/views";
import { JsonDump } from "./json-dump";

/**
 * A verdict's `detail`, drawn by whatever that problem supplied.
 *
 * The kernel used to draw it itself, recognising `{ tests, message }` and
 * falling through to a dump for anything else. That shape is a convention
 * between one set of problems and the backends that judge them, not part of
 * the protocol — `verdictSchema` says `detail: z.unknown()` and means it — so
 * knowing it here made the one field the kernel promises not to read the one
 * field it read most carefully.
 *
 * Keyed by problem rather than by deployment because `detail` is written by
 * *that problem's* backend. Same reason `Ruleset.render` belongs to the format
 * that computed the cells.
 */
export function VerdictBody({
  problemSlug,
  verdict,
}: {
  problemSlug: string;
  verdict: Verdict;
}) {
  if (verdict.detail === undefined) return null;

  const Detail = viewsFor(problemSlug).VerdictDetail;
  if (Detail) return <Detail verdict={verdict} />;

  return <JsonDump value={verdict.detail} />;
}
