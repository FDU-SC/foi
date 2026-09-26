import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Shared loading placeholders sized to reduce layout shifts.
 * Routes supply column widths.
 */

export function Breadcrumb() {
  return (
    <div className="flex items-center gap-2">
      <Skeleton className="h-3 w-10" />
      <Skeleton className="h-3 w-3" />
      <Skeleton className="h-3 w-24" />
    </div>
  );
}

/**
 * A bordered table stand-in. Laid out with flex rather than `<table>` — nothing
 * here is tabular data, and the widths are easier to control.
 */
export function TableSkeleton({
  head,
  rows = 6,
}: {
  head: string[];
  rows?: number;
}) {
  return (
    <div className="oj-table-frame">
      <div className="bg-surface-2 border-border flex items-center gap-4 border-b px-4 py-3">
        {head.map((width, index) => (
          <Skeleton key={index} className={cn("h-3", width)} />
        ))}
      </div>
      <div className="divide-border divide-y">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex items-center gap-4 px-4 py-3">
            {head.map((width, index) => (
              <Skeleton key={index} className={cn("h-4", width)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Paragraph stand-in. The last line is short, the way prose actually ends. */
export function TextBlock({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: lines }, (_, line) => (
        <Skeleton
          key={line}
          className={cn("h-3.5", line === lines - 1 ? "w-2/5" : "w-full")}
        />
      ))}
    </div>
  );
}
