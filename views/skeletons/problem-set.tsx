import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { PageHeading, TableSkeleton } from "@/views/skeletons/parts";

export function ProblemSetSkeleton() {
  return (
    <SkeletonScreen label="正在加载题库" className="space-y-5">
      <PageHeading />
      <div className="grid items-start gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="flex gap-2 overflow-hidden lg:flex-col lg:gap-4">
          <Skeleton className="h-8 w-24 shrink-0 lg:w-full" />
          {[5, 4, 5].map((count, group) => (
            <div key={group} className="contents lg:block lg:space-y-1.5">
              <Skeleton className="hidden h-3 w-20 lg:block" />
              <Skeleton className="hidden h-1.5 w-full rounded-full lg:block" />
              {Array.from({ length: count }, (_, index) => (
                <Skeleton key={index} className="h-8 w-24 shrink-0 lg:h-11 lg:w-full" />
              ))}
            </div>
          ))}
        </div>
        <div className="min-w-0 space-y-3">
          <Skeleton className="h-7 w-32" />
          <div className="border-border space-y-2 rounded-lg border p-3">
            <Skeleton className="h-9 w-full max-w-md" />
          </div>
          <TableSkeleton head={["w-16", "w-20", "flex-1", "w-24"]} rows={10} />
        </div>
      </div>
    </SkeletonScreen>
  );
}
