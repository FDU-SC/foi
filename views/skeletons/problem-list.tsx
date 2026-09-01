import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { PageHeading, TableSkeleton } from "@/views/skeletons/parts";

export function ProblemListSkeleton() {
  return (
    <SkeletonScreen label="正在加载题库" className="space-y-5">
      <div className="flex items-baseline justify-between">
        <PageHeading width="w-20" />
        <Skeleton className="h-3.5 w-16" />
      </div>
      <TableSkeleton head={["w-16", "flex-1", "w-24"]} rows={8} />
    </SkeletonScreen>
  );
}
