import type { ReactNode } from "react";

/**
 * The statement vocabulary this content offers, at the smallest size that
 * still proves the mechanism.
 *
 * The kernel's `mdx-components.tsx` styles headings, tables and code fences
 * and stops there; everything a statement *writes* comes from here, merged in
 * through `content/presentation-modules.ts`. Which components exist is
 * therefore a deployment's decision, and these two are the skeleton's whole
 * answer — deliberately not the same set the repository's own content ships,
 * so that nothing in `lib/` can be quietly depending on `Sample` existing.
 */
export function Callout({
  kind = "note",
  children,
}: {
  kind?: string;
  children: ReactNode;
}) {
  return (
    <div className="border-border bg-surface-2 my-4 rounded-lg border px-4 py-3 text-sm">
      <span className="text-fg-subtle mr-2 font-mono text-xs">{kind}</span>
      {children}
    </div>
  );
}

export function Constraints({
  time,
  memory,
  extra,
}: {
  time?: string;
  memory?: string;
  extra?: Record<string, string>;
}) {
  const entries = [
    ...(time ? [["时间限制", time] as const] : []),
    ...(memory ? [["内存限制", memory] as const] : []),
    ...Object.entries(extra ?? {}),
  ];

  return (
    <dl className="border-border text-fg-muted my-4 flex flex-wrap gap-x-6 gap-y-1 rounded-lg border px-4 py-3 text-xs">
      {entries.map(([label, value]) => (
        <div key={label} className="flex gap-1.5">
          <dt className="text-fg-subtle">{label}</dt>
          <dd className="font-mono">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
