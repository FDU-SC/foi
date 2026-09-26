import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

function JudgeCardSkeleton() {
  return (
    <Card>
      <CardHeader
        title={<Skeleton className="h-4 w-32" />}
        actions={<Skeleton className="h-5 w-20 rounded" />}
      />
      <CardBody className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }, (_, metric) => (
          <div key={metric} className="space-y-2">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-6 w-10" />
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

export function JudgesSkeleton() {
  return (
    <SkeletonScreen label="正在加载评测机状态" className="space-y-5">
      <PageHeader title="评测机" />
      <div className="space-y-4">
        <Skeleton className="h-3 w-72 max-w-full" />
        <div className="grid gap-4 lg:grid-cols-2">
          <JudgeCardSkeleton />
          <JudgeCardSkeleton />
        </div>
      </div>
    </SkeletonScreen>
  );
}
