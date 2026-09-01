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
 * Wraps a whole `loading.tsx` body.
 *
 * The shapes say "content is coming" to anyone looking at the screen and
 * nothing at all to a screen reader, so the wait is announced once in words and
 * the placeholders are hidden.
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
