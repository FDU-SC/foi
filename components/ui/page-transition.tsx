"use client";

import { usePathname } from "next/navigation";
import { useRef, ViewTransition, type ReactNode, type ViewTransitionInstance } from "react";

/** Keep the subtree mounted; navigation must not reset persistent layouts. */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const previousPath = useRef(pathname);

  function onUpdate({ name }: ViewTransitionInstance) {
    const navigated = previousPath.current !== pathname;
    previousPath.current = pathname;
    if (navigated) return;

    const animations = document.getAnimations();
    // A streamed workspace can arrive after the pathname has already changed.
    // Preserve its fade while the page moves from the narrow to the wide layout.
    const geometryChanged = animations.some(({ effect }) => {
      if (!(effect instanceof KeyframeEffect) || effect.pseudoElement !== `::view-transition-group(${name})`) return false;
      const frames = effect.getKeyframes();
      const first = frames[0];
      const last = frames.at(-1);
      return first && last && (first.width !== last.width || first.transform !== last.transform);
    });
    if (geometryChanged) return;

    // Filters, form actions and live refreshes should not fade the whole page.
    // Finish only this boundary's snapshots, leaving nested transitions intact.
    const snapshots = new Set([
      `::view-transition-old(${name})`,
      `::view-transition-new(${name})`,
    ]);
    for (const animation of animations) {
      if (animation.effect instanceof KeyframeEffect && snapshots.has(animation.effect.pseudoElement ?? "")) {
        animation.finish();
      }
    }
  }

  return (
    <ViewTransition default="none" update="page-fade" onUpdate={onUpdate}>
      {children}
    </ViewTransition>
  );
}
