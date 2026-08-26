import type { Verdict } from "@/lib/backend/types";
import { viewsFor } from "@/lib/problems/views";

/**
 * The two fields the kernel promises not to understand, drawn by whoever does.
 *
 * No page can import a particular problem's view: what is on screen depends on
 * which problem the row belongs to, and that is only known at render time.
 * `viewsFor` is that dispatch — see `lib/problems/views.ts` for where a view
 * comes from.
 */

/**
 * Pretty-printed and nothing else. Not a placeholder waiting for a nicer
 * default: it is the honest rendering of an unclaimed field, and a deployment
 * that wants a test table or a highlighted source view says so through its own
 * `views.tsx` rather than by teaching the kernel one more shape.
 */
function JsonDump({ value }: { value: unknown }) {
  return (
    <pre className="border-border bg-surface-2 text-fg-muted max-h-96 overflow-auto rounded border px-3 py-2 font-mono text-xs whitespace-pre-wrap">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

/**
 * A submission's `payload`, shown back to whoever sent it.
 *
 * `POST /api/submissions` takes any JSON object, so this shows any JSON
 * object — reaching in for a `source` or a `flag` here would make the page and
 * the stock submitter agree on key names neither the API nor the database has
 * an opinion about.
 *
 * A submission to a problem since deleted from the repository resolves to no
 * view and lands on the dump. That is the right answer rather than a
 * degradation: the row outlives the directory.
 */
export function PayloadBody({
  problemSlug,
  payload,
}: {
  problemSlug: string;
  payload: unknown;
}) {
  if (payload === undefined || payload === null) return null;

  const View = viewsFor(problemSlug).PayloadView;
  if (View) return <View payload={payload} />;

  return <JsonDump value={payload} />;
}

/**
 * A verdict's `detail`, drawn by whatever that problem supplied.
 *
 * `verdictSchema` says `detail: z.unknown()` and means it: `{ tests, message }`
 * is a convention between one set of problems and the backends that judge
 * them, not part of the protocol, so recognising it here would make the one
 * field the kernel promises not to read the one field it read most carefully.
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
