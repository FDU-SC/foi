import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

export function UserProfileSkeleton() {
  return (
    <SkeletonScreen
      label="正在加载用户资料"
      className="bg-surface border-border mx-auto max-w-2xl space-y-4 rounded-lg border p-5"
    >
      <div className="flex items-center gap-5">
        <Skeleton className="size-24 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="w-24" />
        </div>
      </div>
      <div className="flex gap-1.5">
        <Skeleton className="h-5 w-14 rounded" />
        <Skeleton className="h-5 w-14 rounded" />
      </div>
      <Skeleton className="h-3 w-32" />
    </SkeletonScreen>
  );
}
