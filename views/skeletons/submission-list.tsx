import { PageHeader } from "@/components/ui/page";
import { SkeletonScreen } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/views/skeletons/parts";

export function SubmissionListSkeleton() {
  return (
    <SkeletonScreen label="正在加载提交记录" className="space-y-5">
      <PageHeader title="我的提交" />
      <TableSkeleton head={["w-32", "flex-1", "w-20", "w-10"]} rows={7} />
    </SkeletonScreen>
  );
}
