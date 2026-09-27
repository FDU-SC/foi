import Link from "next/link";
import type { ReactNode } from "react";
import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

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
    <section className={`min-w-0 ${className}`}>
      <header className="border-fg flex items-baseline justify-between gap-3 border-b pb-1.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {href && (
          <Link
            href={href}
            aria-label={`查看全部${title}`}
            className="text-fg-muted hover:text-fg text-xs transition-colors"
          >
            全部
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
      <SkeletonScreen label={`正在加载${title}`} className="space-y-4 py-4">
        <Skeleton className="w-3/4" />
        <Skeleton className="w-1/2" />
        <Skeleton className="w-2/3" />
      </SkeletonScreen>
    </HomePanel>
  );
}
