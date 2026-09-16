import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A placeholder block. The travelling highlight comes from `.skeleton`. */
export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton h-4", className)} {...props} />;
}

/**
 * Route loading screen: announce loading once and hide decorative placeholders
 * from screen readers.
 */
export function SkeletonScreen({
  label = "加载中",
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden className={className}>
        {children}
      </div>
    </div>
  );
}
