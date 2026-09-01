import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { Breadcrumb, TableSkeleton } from "@/views/skeletons/parts";

export function StandingsSkeleton() {
  return (
    <SkeletonScreen label="正在加载排行榜" className="space-y-5">
      <Breadcrumb />

      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="ml-auto h-3 w-16" />
      </div>

      <Skeleton className="h-5 w-20 rounded" />
      <TableSkeleton
        head={["w-8", "flex-1", "w-14", "w-10", "w-10", "w-10", "w-10"]}
        rows={10}
      />
    </SkeletonScreen>
  );
}
