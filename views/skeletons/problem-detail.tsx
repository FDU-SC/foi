import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { Breadcrumb, TextBlock } from "@/views/skeletons/parts";

export function ProblemDetailSkeleton() {
  return (
    <SkeletonScreen
      label="正在加载题目"
      className="mx-auto max-w-3xl space-y-6"
    >
      <Breadcrumb />

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
    </SkeletonScreen>
  );
}
