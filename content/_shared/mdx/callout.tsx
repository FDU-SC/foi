import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Hints are ruled in ink; only cautions take a result colour. */
const KINDS = {
  note: { border: "border-fg", label: "提示" },
  tip: { border: "border-fg", label: "技巧" },
  warning: { border: "border-warn", label: "注意" },
  danger: { border: "border-err", label: "警告" },
} as const;

export function Callout({
  kind = "note",
  title,
  children,
}: {
  kind?: keyof typeof KINDS;
  title?: ReactNode;
  children: ReactNode;
}) {
  const { border, label } = KINDS[kind];
  return (
    <div className={cn("my-5 max-w-2xl border-l-2 pl-4", border)}>
      <div className="text-fg mb-0.5 font-sans text-xs font-semibold">
        {title ?? label}
      </div>
      <div className="[&>*:last-child]:mb-0 [&>*:first-child]:mt-0 [&>p]:my-1.5 [&>p]:text-[15px] [&>p]:text-fg-muted">
        {children}
      </div>
    </div>
  );
}
