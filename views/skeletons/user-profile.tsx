import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

function TabsParts() {
  return (
    <div className="border-border flex h-[37px] items-center gap-4 border-b px-3 lg:pl-[276px] xl:pl-[308px]">
      <Skeleton className="h-4 w-10" />
      <Skeleton className="h-4 w-14" />
      <Skeleton className="h-4 w-14" />
    </div>
  );
}

function FactsParts() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3.5 w-44" />
      <Skeleton className="h-3.5 w-32" />
      <Skeleton className="h-3.5 w-36" />
    </div>
  );
}

function IdentityParts() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 lg:block lg:space-y-3">
        <Skeleton className="size-20 shrink-0 rounded-full lg:size-56" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-5 w-24" />
        </div>
      </div>
      <Skeleton className="h-8 w-full rounded-md" />
      <FactsParts />
    </div>
  );
}

function MainParts() {
  return (
    <div className="min-w-0 space-y-4">
      <Skeleton className="h-4 w-20" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="bg-surface border-border space-y-2 rounded-md border p-3">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-1.5 w-full rounded-full" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
      <Skeleton className="h-4 w-40" />
      <div className="bg-surface border-border rounded-md border p-3">
        <Skeleton className="h-32 w-full rounded" />
      </div>
    </div>
  );
}

export function ProfileTabsSkeleton() {
  return (
    <SkeletonScreen label="正在加载主页标签">
      <TabsParts />
    </SkeletonScreen>
  );
}

export function ProfileFactsSkeleton() {
  return (
    <SkeletonScreen label="正在加载做题统计">
      <FactsParts />
    </SkeletonScreen>
  );
}

export function ProfileMainSkeleton() {
  return (
    <SkeletonScreen label="正在加载做题记录">
      <MainParts />
    </SkeletonScreen>
  );
}

export function UserProfileSkeleton() {
  return (
    <SkeletonScreen label="正在加载用户资料" className="space-y-6">
      <TabsParts />
      <div className="grid items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[272px_minmax(0,1fr)]">
        <IdentityParts />
        <MainParts />
      </div>
    </SkeletonScreen>
  );
}
