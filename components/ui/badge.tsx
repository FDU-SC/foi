import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  neutral: "bg-surface-2 text-fg-muted border-border",
  ok: "bg-ok-subtle text-ok border-ok/25",
  err: "bg-err-subtle text-err border-err/25",
  warn: "bg-warn-subtle text-warn border-warn/25",
  partial: "bg-partial-subtle text-partial border-partial/25",
  info: "bg-info-subtle text-info border-info/25",
  primary: "bg-primary-subtle text-primary border-primary/25",
} as const;

export type BadgeTone = keyof typeof TONES;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  mono?: boolean;
}

export function Badge({
  tone = "neutral",
  mono = false,
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5",
        "text-xs leading-none font-medium whitespace-nowrap",
        mono && "font-mono tabular-nums",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
