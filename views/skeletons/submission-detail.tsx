import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";
import { Breadcrumb, TextBlock } from "@/views/skeletons/parts";

export function SubmissionDetailSkeleton() {
  return (
    <SkeletonScreen label="正在加载提交详情" className="min-w-0 space-y-4">
      <Breadcrumb />
      <div className="border-border flex flex-wrap items-center gap-3 border-b pb-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-5 w-14 rounded" />
        <Skeleton className="ml-auto h-3 w-32" />
      </div>
      <Card>
        <CardHeader title="评测详情" />
        <CardBody>
          <TextBlock lines={3} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="提交内容" />
        <CardBody>
          <Skeleton className="h-48 w-full" />
        </CardBody>
      </Card>
    </SkeletonScreen>
  );
}
