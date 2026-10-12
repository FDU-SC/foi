import type { ReactNode } from "react";

function Item({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-fg-muted text-xs">{label}</dt>
      <dd className="text-fg tabular-nums">{value}</dd>
    </div>
  );
}

/** The limits line under a problem's title, ruled like a printed problem sheet. */
export function Constraints({
  time,
  memory,
  extra,
}: {
  time?: string;
  memory?: string;
  extra?: Record<string, ReactNode>;
}) {
  return (
    <dl className="border-t-fg border-b-border my-4 flex flex-wrap gap-x-7 gap-y-1 border-t border-b py-2 text-sm">
      {time ? <Item label="时间限制" value={time} /> : null}
      {memory ? <Item label="内存限制" value={memory} /> : null}
      {Object.entries(extra ?? {}).map(([label, value]) => (
        <Item key={label} label={label} value={value} />
      ))}
    </dl>
  );
}
