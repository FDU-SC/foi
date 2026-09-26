import { PageHeader } from "@/components/ui/page";
import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/views/skeletons/parts";

/** One sidebar entry: a chip on narrow screens, a row with a progress bar on wide ones. */
function ListRow() {
  return (
    <div className="border-border shrink-0 rounded-full border px-3 py-1.5 lg:rounded-md lg:border-transparent lg:px-2">
      <div className="flex items-center gap-2">
        <Skeleton className="h-3.5 w-20 lg:flex-1" />
        <Skeleton className="h-3 w-8" />
      </div>
      <Skeleton className="mt-1.5 hidden h-1.5 rounded-full lg:block" />
    </div>
  );
}

export function CatalogueSkeleton() {
  return (
    <SkeletonScreen label="正在加载题库" className="space-y-5">
      <PageHeader title="题库" />
      <div className="grid items-start gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="flex gap-2 overflow-hidden pb-1 lg:flex-col lg:gap-4 lg:pb-0">
          <ListRow />
          {Array.from({ length: 2 }, (_, group) => (
            <div key={group} className="contents lg:block">
              <Skeleton className="mx-2 my-1 hidden h-4 w-24 lg:block" />
              <div className="contents lg:block lg:space-y-0.5 lg:pl-3">
                {Array.from({ length: 3 }, (_, row) => (
                  <ListRow key={row} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="min-w-0 space-y-3">
          <Skeleton className="h-7 w-40" />
          <div className="border-border flex gap-1 border-b">
            <div className="px-3 py-2">
              <Skeleton className="h-5 w-8" />
            </div>
            <div className="px-3 py-2">
              <Skeleton className="h-5 w-12" />
            </div>
          </div>
          <div className="border-border bg-surface flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <Skeleton className="h-9 w-44" />
            <Skeleton className="h-9 w-14" />
            <div className="hidden gap-2 sm:flex">
              {Array.from({ length: 4 }, (_, filter) => (
                <Skeleton key={filter} className="h-8 w-16" />
              ))}
            </div>
          </div>
          <TableSkeleton head={["w-10", "flex-1", "w-16", "w-12"]} rows={8} />
        </div>
      </div>
    </SkeletonScreen>
  );
}
