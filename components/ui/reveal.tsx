import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * CSS entrance animation works without waiting for hydration.
 * `motion-safe:` leaves content visible when reduced motion is requested.
 */
export const revealClass = "motion-safe:animate-fade-up";

const STEP_MS = 35;

/**
 * Cap stagger delays so long lists do not keep increasing the wait.
 */
const MAX_STEPS = 12;

export function revealDelay(index: number): CSSProperties {
  return { animationDelay: `${Math.min(index, MAX_STEPS) * STEP_MS}ms` };
}

export interface RevealProps extends HTMLAttributes<HTMLDivElement> {
  index?: number;
}

export function Reveal({ index = 0, className, style, ...props }: RevealProps) {
  return (
    <div
      className={cn(revealClass, className)}
      style={{ ...revealDelay(index), ...style }}
      {...props}
    />
  );
}
