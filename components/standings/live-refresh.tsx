"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { PulseDot } from "@/components/ui/pulse-dot";
import { cn } from "@/lib/utils";

const INTERVAL_MS = 15_000;

/**
 * Re-fetches the standings on a timer, so a board left open keeps up.
 *
 * `router.refresh()` rather than an endpoint of its own: it re-runs the page on
 * the server, which means the same authorization and the same freeze masking
 * decide what comes back. A dedicated API would have to reproduce both.
 *
 * Defaults on only while the contest can still move, and skips ticks for a
 * hidden tab — a board left open in a background tab should cost nothing.
 */
export function StandingsLiveRefresh({ defaultOn }: { defaultOn: boolean }) {
  const router = useRouter();
  const [live, setLive] = useState(defaultOn);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!live) return;

    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      startTransition(() => router.refresh());
    }, INTERVAL_MS);

    return () => clearInterval(timer);
  }, [live, router]);

  return (
    <button
      type="button"
      onClick={() => setLive((on) => !on)}
      aria-pressed={live}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
        "hover:bg-surface-2",
        live ? "text-fg-muted" : "text-fg-subtle hover:text-fg-muted",
      )}
    >
      <PulseDot
        active={live}
        className={live ? "bg-ok" : "bg-border-strong"}
      />
      {live
        ? pending
          ? "更新中"
          : `每 ${INTERVAL_MS / 1000} 秒刷新`
        : "自动刷新"}
    </button>
  );
}
