import { viewsFor } from "@/lib/problems/views";
import { JsonDump } from "./json-dump";

/**
 * A submission's `payload`, shown back to whoever sent it.
 *
 * The kernel used to pull `source`, `flag` or `text` out of it and label the
 * result, which meant the submission page and the stock submitter had to agree
 * on three key names that neither the API nor the database has any opinion
 * about. `POST /api/submissions` takes any JSON object; this shows any JSON
 * object, unless the problem it was sent to says how.
 *
 * A submission to a problem since deleted from the repository resolves to no
 * view and lands on the dump. That is the right answer rather than a
 * degradation: the row outlives the directory, and nothing is left that could
 * claim to know what the payload meant.
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
