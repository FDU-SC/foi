import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const VARIANTS = {
  primary:
    "ui-primary bg-primary text-primary-fg hover:bg-primary-hover disabled:hover:bg-primary",
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
  /** Waiting on the action this button started: disables it and shows a spinner. */
  pending?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  pending = false,
  disabled,
  className,
  children,
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
      disabled={pending || disabled}
      {...props}
    >
      {pending ? <Spinner /> : null}
      {children}
    </button>
  );
}
