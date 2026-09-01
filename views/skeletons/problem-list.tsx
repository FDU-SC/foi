import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { PageHeading, TableSkeleton } from "@/views/skeletons/parts";

/** Chip widths per row, standing in for the facet, status and sort rows. */
const CHIPS = [
  ["w-12", "w-12", "w-14", "w-12"],
  ["w-14", "w-16", "w-12", "w-16", "w-14", "w-12"],
  ["w-14", "w-14", "w-14"],
];

function FiltersSkeleton() {
  return (
    <div className="border-border space-y-3 rounded-xl border p-4">
      <div className="flex gap-2">
        <Skeleton className="h-9 w-64 rounded-md" />
        <Skeleton className="h-9 w-16 rounded-md" />
      </div>
      {CHIPS.map((row, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Skeleton className="h-3 w-10 shrink-0" />
          {row.map((width, chip) => (
            <Skeleton key={chip} className={`h-5 rounded-md ${width}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ProblemListSkeleton() {
  return (
    <SkeletonScreen label="正在加载题库" className="space-y-5">
      <div className="flex items-baseline justify-between">
        <PageHeading width="w-20" />
        <Skeleton className="h-3.5 w-16" />
      </div>
      <FiltersSkeleton />
      <TableSkeleton head={["w-16", "flex-1", "w-16", "w-40"]} rows={8} />
    </SkeletonScreen>
  );
}
