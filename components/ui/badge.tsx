import type { HTMLAttributes } from "react";
import type { BadgeTone } from "@/lib/presentation";
import { cn } from "@/lib/utils";

/** A badge is coloured text: the tone is the only thing it adds. */
const TONES: Record<BadgeTone, string> = {
  neutral: "text-fg-muted",
  ok: "text-ok",
  err: "text-err",
  warn: "text-warn",
  partial: "text-partial",
  info: "text-info",
  primary: "text-fg",
};

export type { BadgeTone };

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
        "inline-flex items-center gap-1 text-xs leading-none font-medium whitespace-nowrap",
        mono && "font-mono font-semibold tabular-nums",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
