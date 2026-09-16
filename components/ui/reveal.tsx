import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Entrance animation, driven by CSS rather than JavaScript.
 *
 * A JS-driven entrance has to render its "before" state into the server HTML,
 * which leaves the content invisible until hydration finishes. These pages are
 * server-rendered and mostly free of client JavaScript; keeping the entrance in
 * CSS is what preserves that. `motion-safe:` drops the whole thing when the
 * viewer asked for less motion, leaving the element plainly visible.
 */
export const revealClass = "motion-safe:animate-fade-up";

const STEP_MS = 35;

/**
 * Capped on purpose. Past a dozen rows the ramp stops reading as sequence and
 * starts reading as lag, so the tail of a long list arrives together.
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
