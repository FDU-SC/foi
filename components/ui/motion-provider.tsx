"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * Makes every Motion component honour the reader's motion preference.
 *
 * The `prefers-reduced-motion` rule in `globals.css` only reaches CSS. Motion
 * writes inline styles from JavaScript and never sees it, so the same promise
 * has to be made again here — `"user"` keeps opacity and colour but drops
 * transform and layout animation.
 *
 * Only `children` crosses this boundary, so the tree below stays server-rendered.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
