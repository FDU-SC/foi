import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

function TabsParts() {
  return (
    <div className="border-border flex h-[37px] items-center gap-5 border-b">
      <Skeleton className="h-4 w-10" />
      <Skeleton className="h-4 w-14" />
      <Skeleton className="h-4 w-14" />
    </div>
  );
}

function FactsParts() {
  return <Skeleton className="h-3.5 w-64" />;
}

function IdentityParts() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3.5 w-20" />
        </div>
      </div>
      <FactsParts />
    </div>
  );
}

function MainParts() {
  return (
    <div className="min-w-0 space-y-9">
      <div className="space-y-3">
        <Skeleton className="h-4 w-20" />
        <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-32 w-full" />
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
      <IdentityParts />
      <TabsParts />
      <MainParts />
    </SkeletonScreen>
  );
}
