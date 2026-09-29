import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A section with a titled rule, not a box. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0", className)} {...props} />;
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
        "border-fg flex flex-wrap items-center justify-between gap-3 border-b pb-1.5",
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
  return <div className={cn("py-3", className)} {...props} />;
}
