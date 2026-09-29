import { PageHeader } from "@/components/ui/page";
import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { TextBlock } from "@/views/skeletons/parts";

export function AnnouncementListSkeleton() {
  return (
    <SkeletonScreen label="正在加载公告" className="max-w-3xl space-y-5">
      <PageHeader title="公告" />
      <div className="border-fg border-t">
        {Array.from({ length: 4 }, (_, entry) => (
          <div key={entry} className="border-border space-y-2 border-b py-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}

export function AnnouncementDetailSkeleton() {
  return (
    <SkeletonScreen label="正在加载公告内容" className="max-w-3xl space-y-5">
      <Skeleton className="w-14" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="w-40" />
      </div>
      <div className="oj-statement border-fg space-y-6 border-t pt-4">
        <TextBlock lines={4} />
        <TextBlock lines={3} />
      </div>
    </SkeletonScreen>
  );
}
