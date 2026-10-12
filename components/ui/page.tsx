import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-fg text-xl font-bold">{title}</h1>
        {description ? (
          <p className="text-fg-muted mt-1 text-sm leading-6">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

/** A visual frame only: callers own the table, its columns and its data. */
export function TableFrame({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("oj-table-frame", className)} {...props} />;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="text-fg-muted border-border border-y py-10 text-center text-sm">
      {children}
    </p>
  );
}
