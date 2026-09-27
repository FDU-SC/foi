import styles from "@/components/contests/workspace.module.css";
import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TextBlock } from "@/views/skeletons/parts";

/** The contest workspace with its sidebar expanded, so the swap does not jump. */
export function ContestWorkspaceSkeleton() {
  return (
    <SkeletonScreen label="正在加载比赛">
      <div data-contest-workspace className={styles.root}>
        <div className={styles.toolbar}>
          <Skeleton className="h-7 w-64 max-w-full" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="ml-auto hidden h-4 w-16 lg:block" />
        </div>
        <div className={cn(styles.workspace, styles.expanded)}>
          <div className="border-b py-3 lg:hidden">
            <Skeleton className="h-4 w-40" />
          </div>
          <div className={cn(styles.panel, "space-y-6 pt-1")}>
            <TextBlock lines={4} />
            <TextBlock lines={3} />
            <Skeleton className="h-40 w-full" />
          </div>
          <div className={cn(styles.sidebar, "hidden min-h-0 flex-col lg:flex")}>
            <div className={styles.sidebarContent}>
              <div className="mb-2 border-b py-2">
                {Array.from({ length: 2 }, (_, link) => (
                  <div key={link} className="py-1.5 pl-3.5">
                    <Skeleton className="w-20" />
                  </div>
                ))}
              </div>
              <div className="py-2 pl-3.5">
                <Skeleton className="w-10" />
              </div>
              <div className="pb-2">
                {Array.from({ length: 5 }, (_, problem) => (
                  <div key={problem} className="flex gap-2 py-1.5 pl-3.5">
                    <Skeleton className="w-5 shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="w-full" />
                      <Skeleton className="h-3 w-10" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SkeletonScreen>
  );
}
