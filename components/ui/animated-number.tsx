"use client";

import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";

/**
 * Animate value changes. Initialize the spring at the first value to match
 * server and client text and avoid counting up on page load.
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
