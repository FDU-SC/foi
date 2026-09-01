import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Placeholder shapes shared by the route skeletons.
 *
 * The point of each is to occupy the space the real content will, so the page
 * does not jump when it arrives. Column widths are passed in per route rather
 * than guessed here.
 */

export function PageHeading({ width = "w-28" }: { width?: string }) {
  return <Skeleton className={cn("h-8", width)} />;
}

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
    <div className="border-border overflow-hidden rounded-lg border">
      <div className="bg-surface-2 border-border flex items-center gap-4 border-b px-4 py-3">
        {head.map((width, index) => (
          <Skeleton key={index} className={cn("h-3", width)} />
        ))}
      </div>
      <div className="divide-border divide-y">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex items-center gap-4 px-4 py-3.5">
            {head.map((width, index) => (
              <Skeleton key={index} className={cn("h-4", width)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="border-border divide-border divide-y overflow-hidden rounded-lg border">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex flex-wrap items-center gap-3 px-4 py-4">
          <Skeleton className="h-5 w-14 rounded" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-5 w-20 rounded" />
          <Skeleton className="ml-auto h-3 w-28" />
        </div>
      ))}
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
