import Link from "next/link";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export function HomePanel({
  title,
  href,
  children,
  className = "",
}: {
  title: string;
  href?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`ui-panel min-w-0 overflow-hidden rounded-lg border border-border bg-surface ${className}`}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface-2/40 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {href && (
          <Link
            href={href}
            aria-label={`查看全部${title}`}
            className="text-fg-muted hover:text-primary text-xs"
          >
            全部 <span aria-hidden="true">→</span>
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

export function HomePanelSkeleton({
  title,
  className,
}: {
  title: string;
  className?: string;
}) {
  return (
    <HomePanel title={title} className={className}>
      <div role="status" aria-label="正在加载" className="space-y-4 p-4">
        <Skeleton className="w-3/4" />
        <Skeleton className="w-1/2" />
        <Skeleton className="w-2/3" />
      </div>
    </HomePanel>
  );
}
