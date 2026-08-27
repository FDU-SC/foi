import { viewsFor } from "@/lib/problems/views";

function JsonDump({ value }: { value: unknown }) {
  return (
    <pre className="border-border bg-surface-2 text-fg-muted max-h-96 overflow-auto rounded border px-3 py-2 font-mono text-xs whitespace-pre-wrap">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

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

export function VerdictBody({
  problemSlug,
  detail,
}: {
  problemSlug: string;
  detail: unknown;
}) {
  if (detail === undefined || detail === null) return null;

  const Detail = viewsFor(problemSlug).VerdictDetail;
  if (Detail) return <Detail detail={detail} />;

  return <JsonDump value={detail} />;
}
