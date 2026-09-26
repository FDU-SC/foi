import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

function FieldCard({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="space-y-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-20" />
      </CardBody>
    </Card>
  );
}

export function SettingsSkeleton() {
  return (
    <SkeletonScreen label="正在加载个人设置" className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-fg text-2xl font-bold tracking-tight">个人设置</h1>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="min-w-0 space-y-4">
          <h2 className="text-sm font-semibold">个人资料</h2>
          <FieldCard title="昵称" />
          <FieldCard title="头像" />
          <FieldCard title="用户名" />
        </section>
        <section className="min-w-0 space-y-4">
          <h2 className="text-sm font-semibold">账号安全</h2>
          <FieldCard title="邮箱" />
          <FieldCard title="密码" />
        </section>
      </div>
    </SkeletonScreen>
  );
}

export function EmailConfirmSkeleton() {
  return (
    <SkeletonScreen label="正在确认修改邮箱" className="mx-auto max-w-lg space-y-4">
      <h1 className="text-fg text-2xl font-bold tracking-tight">确认修改邮箱</h1>
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
    </SkeletonScreen>
  );
}
