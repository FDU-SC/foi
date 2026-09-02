import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { TextBlock } from "@/views/skeletons/parts";

function FeaturedStripSkeleton() {
  return (
    <div className="border-border rounded-xl border">
      <div className="grid gap-8 p-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-5 w-24" />
          <TextBlock lines={2} />
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3.5 w-3/5" />
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3.5 w-1/2" />
        </div>
      </div>
      <div className="border-border flex items-center gap-3 border-t px-5 py-2.5">
        <Skeleton className="h-3 w-10" />
        <Skeleton className="ml-auto h-3 w-14" />
      </div>
    </div>
  );
}

function PaneSkeleton() {
  return (
    <div className="bg-surface grid gap-6 p-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Skeleton className="h-5 w-24" />
        <TextBlock lines={1} />
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3.5 w-3/5" />
        <div className="flex gap-1.5 pt-1">
          <Skeleton className="h-5 w-12 rounded-md" />
          <Skeleton className="h-5 w-10 rounded-md" />
        </div>
      </div>
    </div>
  );
}

export function CatalogueIndexSkeleton() {
  return (
    <SkeletonScreen label="正在加载题库" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Skeleton className="mb-2 h-3 w-20" />
          <Skeleton className="h-8 w-16" />
        </div>
        <Skeleton className="h-4 w-64" />
      </div>

      <FeaturedStripSkeleton />

      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-10" />
        </div>
        <div className="border-border bg-border overflow-hidden rounded-xl border">
          <div className="grid gap-px sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, tile) => (
              <PaneSkeleton key={tile} />
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-3 w-10" />
        </div>
        <div className="border-border bg-border overflow-hidden rounded-xl border">
          <div className="grid gap-px sm:grid-cols-2">
            <PaneSkeleton />
            <PaneSkeleton />
          </div>
        </div>
      </div>
    </SkeletonScreen>
  );
}
