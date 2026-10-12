import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { Breadcrumb, TextBlock } from "@/views/skeletons/parts";

export function ProblemDetailSkeleton() {
  return (
    <SkeletonScreen label="正在加载题目" className="space-y-4">
      <Breadcrumb />
      <div className="space-y-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="grid items-start gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="oj-sidebar lg:col-start-2 lg:row-start-1">
          <TextBlock lines={5} />
        </div>
        <div className="oj-statement space-y-6 lg:col-start-1 lg:row-start-1">
          <Skeleton className="h-8 w-full" />
          <TextBlock lines={4} />
          <TextBlock lines={3} />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </SkeletonScreen>
  );
}
