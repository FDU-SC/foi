import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-surface border-border overflow-hidden rounded-lg border",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  actions,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "border-border bg-surface-2/50 flex items-center justify-between gap-3 border-b px-4 py-2.5",
        className,
      )}
      {...props}
    >
      <div className="text-fg text-sm font-semibold">{title}</div>
      {actions}
    </div>
  );
}

export function CardBody({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-3", className)} {...props} />;
}
