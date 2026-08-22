import type { ReactNode } from "react";
import { CopyButton } from "@/components/ui/copy-button";

function Pane({ label, content }: { label: string; content: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="border-border bg-surface-2/50 flex items-center justify-between border-b px-3 py-1.5">
        <span className="text-fg-subtle text-[11px] font-medium tracking-wide uppercase">
          {label}
        </span>
        <CopyButton value={content} />
      </div>
      <pre className="text-fg overflow-x-auto px-3 py-2.5 font-mono text-[13px] leading-relaxed whitespace-pre">
        {content}
      </pre>
    </div>
  );
}

export function Sample({
  n,
  input,
  output,
  note,
}: {
  n?: number;
  input: string;
  output: string;
  note?: ReactNode;
}) {
  return (
    <figure className="border-border my-4 overflow-hidden rounded-lg border">
      {n !== undefined ? (
        <figcaption className="border-border bg-surface-2 text-fg border-b px-3 py-1.5 text-xs font-semibold">
          样例 {n}
        </figcaption>
      ) : null}
      <div className="divide-border flex flex-col divide-y sm:flex-row sm:divide-x sm:divide-y-0">
        <Pane label="输入" content={input} />
        <Pane label="输出" content={output} />
      </div>
      {note ? (
        <div className="border-border bg-surface-2/40 text-fg-muted border-t px-3 py-2 text-sm">
          {note}
        </div>
      ) : null}
    </figure>
  );
}
