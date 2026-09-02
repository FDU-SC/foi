import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { TextBlock } from "@/views/skeletons/parts";

function SectionTileSkeleton() {
  return (
    <div className="border-border flex flex-col rounded-xl border">
      <div className="space-y-3 p-5">
        <Skeleton className="h-5 w-32" />
        <TextBlock lines={2} />
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3.5 w-3/5" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-12 rounded-md" />
          <Skeleton className="h-5 w-14 rounded-md" />
          <Skeleton className="h-5 w-10 rounded-md" />
        </div>
      </div>
      <div className="border-border flex items-center gap-3 border-t px-5 py-3">
        <Skeleton className="h-1.5 flex-1 rounded-full" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}

export function CatalogueIndexSkeleton() {
  return (
    <SkeletonScreen label="正在加载题库" className="space-y-10">
      <div>
        <Skeleton className="mb-4 h-3 w-20" />
        <Skeleton className="h-10 w-28 sm:h-12" />
        <div className="mt-4 max-w-2xl">
          <TextBlock lines={1} />
        </div>
      </div>

      {[0, 1].map((group) => (
        <div key={group} className="space-y-4">
          <div className="flex items-baseline justify-between">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-3 w-10" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 2 }, (_, tile) => (
              <SectionTileSkeleton key={tile} />
            ))}
          </div>
        </div>
      ))}
    </SkeletonScreen>
  );
}
