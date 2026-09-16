"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * Apply reduced-motion preferences to Motion's JavaScript animations, which
 * CSS media rules do not control. `"user"` keeps opacity and colour animations
 * but disables transform and layout animation.
 * Only `children` crosses the boundary, preserving server-rendered descendants.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
