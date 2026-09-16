"use client";

import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";

/**
 * A number that travels to its new value instead of jumping.
 *
 * On a board that refreshes on a timer, a changed figure is easy to miss; the
 * movement is what draws the eye to it. The spring starts at the first value,
 * so the server and the client render the same text and nothing counts up on
 * page load.
 */
export function AnimatedNumber({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const spring = useSpring(value, { stiffness: 180, damping: 26, mass: 0.6 });
  const text = useTransform(spring, (current) =>
    Math.round(current).toString(),
  );

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  if (reduced) return <span className={className}>{value}</span>;

  return <motion.span className={className}>{text}</motion.span>;
}
