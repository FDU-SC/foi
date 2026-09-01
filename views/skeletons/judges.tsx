import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { PageHeading, TextBlock } from "@/views/skeletons/parts";

function JudgeCardSkeleton() {
  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <div className="bg-surface-2/50 border-border flex items-center justify-between border-b px-4 py-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-5 w-20 rounded" />
      </div>
      <div className="grid grid-cols-3 gap-3 px-4 py-4">
        {Array.from({ length: 3 }, (_, metric) => (
          <div key={metric} className="space-y-2">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-6 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function JudgesSkeleton() {
  return (
    <SkeletonScreen label="正在加载评测机状态" className="space-y-5">
      <div className="space-y-3">
        <PageHeading width="w-24" />
        <TextBlock lines={2} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <JudgeCardSkeleton />
        <JudgeCardSkeleton />
      </div>
    </SkeletonScreen>
  );
}
