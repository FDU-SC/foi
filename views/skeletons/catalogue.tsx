import { PageHeader } from "@/components/ui/page";
import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/views/skeletons/parts";

/** One sidebar entry: a title and its count. */
function ListRow({ indent = false }: { indent?: boolean }) {
  return (
    <div className={`flex shrink-0 items-center gap-2 py-1 ${indent ? "lg:pl-6" : "lg:pl-3"}`}>
      <Skeleton className="h-3.5 w-20 lg:flex-1" />
      <Skeleton className="h-3 w-8" />
    </div>
  );
}

export function CatalogueSkeleton() {
  return (
    <SkeletonScreen label="正在加载题库" className="space-y-5">
      <PageHeader title="题库" />
      <div className="grid items-start gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="flex gap-4 overflow-hidden lg:flex-col lg:gap-5">
          <ListRow />
          {Array.from({ length: 2 }, (_, group) => (
            <div key={group} className="contents lg:block">
              <ListRow />
              <div className="contents lg:block">
                {Array.from({ length: 3 }, (_, row) => (
                  <ListRow key={row} indent />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="min-w-0 space-y-3">
          <Skeleton className="h-7 w-40" />
          <div className="border-border flex gap-5 border-b py-2">
            <Skeleton className="h-5 w-8" />
            <Skeleton className="h-5 w-12" />
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Skeleton className="h-8 w-44" />
            <Skeleton className="h-8 w-14" />
            <div className="hidden gap-5 sm:flex">
              {Array.from({ length: 4 }, (_, filter) => (
                <Skeleton key={filter} className="h-5 w-12" />
              ))}
            </div>
          </div>
          <TableSkeleton head={["w-10", "flex-1", "w-16", "w-12"]} rows={8} />
        </div>
      </div>
    </SkeletonScreen>
  );
}
