import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { PageHeading, TableSkeleton } from "@/views/skeletons/parts";

function SearchSkeleton() {
  return (
    <div className="border-border flex items-center gap-2 rounded-xl border p-4">
      <Skeleton className="h-9 w-64 rounded-md" />
      <Skeleton className="h-9 w-16 rounded-md" />
    </div>
  );
}

export function ProblemListSkeleton() {
  return (
    <SkeletonScreen label="正在加载题库" className="space-y-5">
      <div className="flex items-baseline gap-3">
        <PageHeading width="w-24" />
        <Skeleton className="ml-auto h-3.5 w-20" />
        <Skeleton className="h-3.5 w-16" />
      </div>
      <SearchSkeleton />
      <TableSkeleton head={["w-16", "flex-1", "w-16", "w-40"]} rows={8} />
    </SkeletonScreen>
  );
}
