"use client";

import { motion } from "motion/react";
import { useSyncExternalStore, ViewTransition } from "react";
import { LAYOUT_SPRING } from "@/components/ui/motion";

const subscribe = () => () => {};
const supportsViewTransitions = () => typeof document.startViewTransition === "function";
const serverSnapshot = () => false;

/** Native snapshots hide Motion's live frames, so give the marker its own layer. */
export function NavigationIndicator({ name, className }: { name: string; className: string }) {
  const native = useSyncExternalStore(subscribe, supportsViewTransitions, serverSnapshot);

  return (
    <ViewTransition name={name} default="none" share="navigation-marker">
      <motion.span
        aria-hidden="true"
        layoutId={native ? undefined : name}
        transition={LAYOUT_SPRING}
        className={className}
      />
    </ViewTransition>
  );
}
