import { SkeletonScreen } from "@/components/ui/skeleton";
import { ListSkeleton, PageHeading } from "@/views/skeletons/parts";

export function ContestListSkeleton() {
  return (
    <SkeletonScreen label="正在加载比赛" className="space-y-5">
      <PageHeading width="w-16" />
      <ListSkeleton rows={4} />
    </SkeletonScreen>
  );
}
