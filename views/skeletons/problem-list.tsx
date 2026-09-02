import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { Breadcrumb, PageHeading, TableSkeleton } from "@/views/skeletons/parts";

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

export function ProblemListSkeleton() {
  return (
    <SkeletonScreen label="正在加载题目列表" className="space-y-5">
      <Breadcrumb />
      <div className="flex items-baseline gap-3">
        <PageHeading width="w-32" />
        <Skeleton className="ml-auto h-3.5 w-20" />
        <Skeleton className="h-3.5 w-16" />
      </div>
      <FiltersSkeleton />
      <TableSkeleton head={["w-16", "flex-1", "w-16", "w-40"]} rows={8} />
    </SkeletonScreen>
  );
}
