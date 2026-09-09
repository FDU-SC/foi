import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import {
  Breadcrumb,
  PageHeading,
  TableSkeleton,
} from "@/views/skeletons/parts";

export function ProblemListSkeleton() {
  return (
    <SkeletonScreen label="正在加载题目列表" className="space-y-3">
      <Breadcrumb />
      <PageHeading width="w-32" />
      <Skeleton className="h-4 w-2/3" />
      <div className="border-border space-y-2 rounded-lg border p-4">
        <Skeleton className="h-9 w-full max-w-md" />
      </div>
      <TableSkeleton head={["w-20", "flex-1", "w-24"]} rows={10} />
    </SkeletonScreen>
  );
}
