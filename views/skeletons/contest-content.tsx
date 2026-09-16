import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { TextBlock } from "@/views/skeletons/parts";

export function ContestContentSkeleton() {
  return (
    <SkeletonScreen label="正在加载比赛内容" className="space-y-6">
      <Skeleton className="h-8 w-2/3" />
      <div className="border-border space-y-6 rounded-lg border p-4 sm:p-6">
        <TextBlock lines={4} />
        <TextBlock lines={3} />
        <Skeleton className="h-40 w-full" />
      </div>
    </SkeletonScreen>
  );
}
