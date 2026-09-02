import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { PageHeading, TextBlock } from "@/views/skeletons/parts";

function SectionTileSkeleton() {
  return (
    <div className="border-border space-y-2.5 rounded-xl border px-4 py-4">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-3/5" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

export function CatalogueIndexSkeleton() {
  return (
    <SkeletonScreen label="正在加载题库" className="space-y-8">
      <div className="space-y-2">
        <PageHeading width="w-24" />
        <TextBlock lines={1} />
      </div>

      {[0, 1].map((group) => (
        <div key={group} className="space-y-3">
          <Skeleton className="h-4 w-20" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: group === 0 ? 3 : 2 }, (_, tile) => (
              <SectionTileSkeleton key={tile} />
            ))}
          </div>
        </div>
      ))}
    </SkeletonScreen>
  );
}
