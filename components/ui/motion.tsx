import * as motion from "motion/react-client";
import type { HTMLMotionProps, Transition } from "motion/react";

/**
 * Shared timings, so every animated surface settles the same way.
 *
 * `motion/react-client` is the package's pre-marked client entry, which is what
 * lets a Server Component render these without becoming one itself. Props cross
 * that boundary as data, so everything here stays plain serialisable objects.
 */

/** Position and size changes: overshoots slightly, which reads as physical. */
export const LAYOUT_SPRING: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.9,
};

/** Something arriving that was not there before. */
export const POP_SPRING: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 26,
  mass: 0.7,
};

/** Opacity and colour, where a spring would only look indecisive. */
export const QUICK: Transition = { duration: 0.18, ease: [0.16, 1, 0.3, 1] };

/**
 * A table row that animates to its new position when the ordering changes.
 *
 * Identity comes from the `key` the caller supplies: React keeps the instance
 * across a re-render, and Motion measures the gap between where the row was and
 * where it landed.
 */
export function MotionTr(props: HTMLMotionProps<"tr">) {
  return <motion.tr layout transition={LAYOUT_SPRING} {...props} />;
}
