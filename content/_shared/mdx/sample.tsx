import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";

function Pane({ label, content, className }: { label: string; content: string; className?: string }) {
  return (
    <div className={cn("border-border min-w-0", className)}>
      <div className="bg-surface-2 flex items-center justify-between px-3 py-1">
        <span className="text-fg-muted text-xs">{label}</span>
        <CopyButton value={content} />
      </div>
      <pre className="text-fg border-border overflow-x-auto border-t px-3 py-2 font-mono text-[13px] leading-relaxed whitespace-pre">
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
  const suffix = n !== undefined ? ` #${n}` : "";
  return (
    <figure className="my-4">
      <div className="border-border grid border sm:grid-cols-2">
        <Pane label={`输入${suffix}`} content={input} />
        <Pane label={`输出${suffix}`} content={output} className="border-t sm:border-t-0 sm:border-l" />
      </div>
      {note ? (
        <figcaption className="text-fg-muted mt-1.5 font-serif text-[15px] leading-7 [&_p]:my-0 [&_p]:text-inherit">
          {note}
        </figcaption>
      ) : null}
    </figure>
  );
}
