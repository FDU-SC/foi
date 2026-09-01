import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const VARIANTS = {
  primary:
    "bg-primary text-primary-fg hover:bg-primary-hover shadow-[0_1px_2px_oklch(20%_0.04_265/0.12),0_0_20px_-6px_var(--primary)] hover:shadow-[0_0_28px_-4px_var(--primary)] disabled:hover:bg-primary",
  secondary:
    "bg-surface border border-border text-fg hover:bg-surface-2 hover:border-border-strong",
  ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg",
  danger: "bg-err text-white hover:opacity-90",
} as const;

const SIZES = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-11 px-5 text-base gap-2",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium",
        "transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-200 ease-out",
        "motion-safe:active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
