import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { TextBlock } from "@/views/skeletons/parts";
import styles from "@/components/contests/workspace.module.css";

export function ContestContentSkeleton() {
  return (
    <SkeletonScreen label="正在加载比赛内容" className={styles.panel}>
      <div className="flex items-center gap-3 border-b px-4 py-5 sm:px-6">
        <Skeleton className="size-10 shrink-0" />
        <Skeleton className="h-8 w-2/3" />
      </div>
      <div className="space-y-6 p-4 sm:p-6">
        <TextBlock lines={4} />
        <TextBlock lines={3} />
        <Skeleton className="h-40 w-full" />
      </div>
    </SkeletonScreen>
  );
}
