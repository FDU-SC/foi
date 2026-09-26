import { AdminNav } from "@/components/admin/admin-nav";
import { PageHeader } from "@/components/ui/page";
import { SkeletonScreen } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/views/skeletons/parts";

/**
 * Admin pages share a static navigation. It stays outside the status region:
 * its links remain usable and must not sit under `aria-hidden`.
 */
export function AdminSkeleton({
  title,
  nested = false,
}: {
  title: string;
  nested?: boolean;
}) {
  return (
    <div className="space-y-4">
      <AdminNav />
      <SkeletonScreen label="正在加载管理页面" className="space-y-4">
        {nested ? (
          <p className="text-fg-subtle text-xs">
            管理<span className="mx-1.5">/</span>{title}
          </p>
        ) : null}
        <PageHeader title={title} />
        <TableSkeleton head={["w-32", "flex-1", "w-24", "w-16"]} />
      </SkeletonScreen>
    </div>
  );
}
