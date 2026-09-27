import { PageHeader } from "@/components/ui/page";
import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/views/skeletons/parts";

export function ContestListSkeleton() {
  return (
    <SkeletonScreen label="正在加载比赛列表" className="space-y-5">
      <PageHeader title="比赛" />
      <div className="border-border flex gap-5 border-b py-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-5 w-16" />
        ))}
      </div>
      <TableSkeleton head={["flex-1", "w-32", "w-16", "w-20", "w-24", "w-12"]} rows={4} />
    </SkeletonScreen>
  );
}
