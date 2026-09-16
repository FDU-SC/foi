import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { Breadcrumb, TextBlock } from "@/views/skeletons/parts";

export function ProblemDetailSkeleton() {
  return (
    <SkeletonScreen label="正在加载题目" className="space-y-4">
      <Breadcrumb />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-5 w-32" />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="oj-sidebar lg:col-start-2 lg:row-start-1">
          <TextBlock lines={5} />
        </div>
        <div className="border-border space-y-6 rounded-lg border p-4 sm:p-6 lg:col-start-1 lg:row-start-1">
          <TextBlock lines={4} />
          <TextBlock lines={3} />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </SkeletonScreen>
  );
}
