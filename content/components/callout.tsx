import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const KINDS = {
  note: { border: "border-l-info", bg: "bg-info-subtle/40", label: "提示" },
  tip: { border: "border-l-ok", bg: "bg-ok-subtle/40", label: "技巧" },
  warning: { border: "border-l-warn", bg: "bg-warn-subtle/40", label: "注意" },
  danger: { border: "border-l-err", bg: "bg-err-subtle/40", label: "警告" },
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
  const { border, bg, label } = KINDS[kind];
  return (
    <div className={cn("my-4 rounded-r border-l-2 px-4 py-3", border, bg)}>
      <div className="text-fg mb-1 text-xs font-semibold tracking-wide">
        {title ?? label}
      </div>
      <div className="text-fg-muted [&>*:last-child]:mb-0 [&>p]:mb-2 [&>p]:text-sm">
        {children}
      </div>
    </div>
  );
}
