import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TextBlock } from "@/views/skeletons/parts";

function SidebarSkeleton() {
  return (
    <div className="flex flex-col">
      <div className="border-border space-y-3 border-b px-4 py-5">
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-12 rounded-md" />
          <Skeleton className="h-5 w-16 rounded-md" />
        </div>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3.5 w-20" />
      </div>
      {Array.from({ length: 6 }, (_, row) => (
        <div
          key={row}
          className="border-border flex items-center gap-2.5 border-b px-4 py-2.5"
        >
          <Skeleton className="size-6 rounded" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-3 w-8" />
        </div>
      ))}
    </div>
  );
}

function PaneSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div className="border-border space-y-3 border-b pb-5">
        <Skeleton className="h-8 w-2/3" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-16 rounded" />
          <Skeleton className="h-5 w-12 rounded" />
        </div>
      </div>
      <TextBlock lines={4} />
      <TextBlock lines={3} />
      <Skeleton className="h-40 w-full rounded-lg" />
    </div>
  );
}

export function ContestWorkspaceSkeleton({
  selected = false,
}: {
  selected?: boolean;
}) {
  const label = selected ? "正在加载题目" : "正在加载比赛";

  return (
    <div
      data-workspace
      role="status"
      aria-busy="true"
      className="flex min-h-0 flex-1"
    >
      <span className="sr-only">{label}</span>
      <aside
        aria-hidden
        className={cn(
          "border-border min-h-0 w-full shrink-0 overflow-hidden lg:w-80 lg:border-r",
          selected ? "hidden lg:block" : "block",
        )}
      >
        <SidebarSkeleton />
      </aside>
      <section
        aria-hidden
        className={cn(
          "min-h-0 min-w-0 flex-1 overflow-hidden",
          selected ? "block" : "hidden lg:block",
        )}
      >
        {selected ? (
          <PaneSkeleton />
        ) : (
          <div className="flex h-full min-h-64 items-center justify-center">
            <Skeleton className="h-3.5 w-40" />
          </div>
        )}
      </section>
    </div>
  );
}
