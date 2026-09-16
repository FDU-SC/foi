import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { PageHeading } from "@/views/skeletons/parts";

export function ContestListSkeleton() {
  return (
    <SkeletonScreen label="正在加载比赛" className="space-y-5">
      <PageHeading width="w-16" />
      <div className="flex gap-3 border-b border-border pb-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-20" />
        ))}
      </div>
      <div className="ui-panel divide-y divide-border rounded-lg border border-border p-4">
        <Skeleton className="mb-4 w-24" />
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex gap-5 py-5">
            <Skeleton className="h-20 w-14 shrink-0" />
            <div className="flex-1 space-y-3">
              <Skeleton className="w-24" />
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}
