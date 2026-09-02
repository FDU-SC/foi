import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { Breadcrumb, PageHeading } from "@/views/skeletons/parts";

/** The filter bar: a search box above however many rows of chips. */
function FiltersSkeleton() {
  return (
    <div className="border-border space-y-3 rounded-xl border p-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-64 rounded-md" />
        <Skeleton className="h-9 w-16 rounded-md" />
      </div>
      {["w-14", "w-20", "w-16"].map((width, row) => (
        <div key={row} className="flex items-center gap-1.5">
          <Skeleton className="h-3 w-10" />
          <Skeleton className={`h-5 rounded-md ${width}`} />
          <Skeleton className="h-5 w-16 rounded-md" />
          <Skeleton className="h-5 w-12 rounded-md" />
        </div>
      ))}
    </div>
  );
}

function ProblemCardSkeleton() {
  return (
    <div className="border-border flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-start justify-between">
        <Skeleton className="size-8 rounded" />
        <Skeleton className="h-5 w-10 rounded-md" />
      </div>
      <Skeleton className="h-5 w-3/4" />
      <div className="mt-auto flex gap-1.5">
        <Skeleton className="h-5 w-12 rounded-md" />
        <Skeleton className="h-5 w-14 rounded-md" />
        <Skeleton className="ml-auto h-3 w-14" />
      </div>
    </div>
  );
}

export function ProblemListSkeleton() {
  return (
    <SkeletonScreen label="正在加载题目列表" className="space-y-5">
      <Breadcrumb />
      <div className="flex items-baseline gap-3">
        <PageHeading width="w-32" />
        <Skeleton className="ml-auto h-3.5 w-20" />
        <Skeleton className="h-3.5 w-16" />
      </div>
      <Skeleton className="h-3.5 w-2/3 max-w-xl" />
      <div className="flex max-w-xs items-center gap-2">
        <Skeleton className="h-1.5 flex-1 rounded-full" />
        <Skeleton className="h-3 w-16" />
      </div>
      <FiltersSkeleton />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, card) => (
          <ProblemCardSkeleton key={card} />
        ))}
      </div>
    </SkeletonScreen>
  );
}
