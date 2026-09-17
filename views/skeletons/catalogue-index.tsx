import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { PageHeading } from "@/views/skeletons/parts";

export function CatalogueIndexSkeleton() {
  return (
    <SkeletonScreen label="正在加载题库" className="space-y-5">
      <PageHeading />
      <Skeleton className="h-4 w-64 max-w-full" />
      <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
        <div className="border-border bg-surface col-span-full grid gap-4 rounded-xl border p-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-6 lg:p-5">
          <div className="space-y-2">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
          <div className="border-border/70 border-t pt-3 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
            <Skeleton className="mb-2 h-4 w-20" />
            <div className="grid gap-2 sm:grid-cols-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          </div>
        </div>
        {[5, 4, 5].map((count, group) => (
          <div
            key={group}
            className="border-border bg-surface overflow-hidden rounded-xl border"
          >
            <div className="bg-surface-2/60 border-b px-4 py-3.5">
              <Skeleton className="h-5 w-32" />
              <div className="mt-3 space-y-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-1.5 w-full rounded-full" />
              </div>
            </div>
            <div className="divide-border/70 divide-y">
              {Array.from({ length: count }, (_, index) => (
                <div key={index} className="space-y-2 px-4 py-3">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-1.5 w-full rounded-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}
