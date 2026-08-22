import type { ReactNode } from "react";

function Item({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-fg-subtle text-[11px] tracking-wide uppercase">
        {label}
      </dt>
      <dd className="text-fg font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Renders the limits box at the top of a statement. Extra key/value pairs can
 * be passed through `extra` for problem types with unusual constraints.
 */
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
    <dl className="border-border bg-surface-2/60 my-4 flex flex-wrap gap-x-8 gap-y-3 rounded-lg border px-4 py-3">
      {time ? <Item label="时间限制" value={time} /> : null}
      {memory ? <Item label="内存限制" value={memory} /> : null}
      {Object.entries(extra ?? {}).map(([label, value]) => (
        <Item key={label} label={label} value={value} />
      ))}
    </dl>
  );
}
