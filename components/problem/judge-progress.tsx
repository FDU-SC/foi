"use client";

import { motion } from "motion/react";
import { LAYOUT_SPRING } from "@/components/ui/motion";
import { isSettled, type SubmissionState } from "@/lib/backend/types";
import { cn } from "@/lib/utils";

const STAGES = ["排队", "评测", "完成"] as const;

/** How far along the three stages each state sits. */
const REACHED: Record<SubmissionState, number> = {
  queued: 0,
  judging: 1,
  completed: 2,
  disrupted: 2,
};

/**
 * Where a submission is between arriving and being answered.
 *
 * A verdict badge says what a submission *is*; this says how much of the wait
 * is left, which is the question someone staring at "评测中" actually has. The
 * stage in progress breathes rather than filling, because nothing here knows
 * how long it will take.
 */
export function JudgeProgress({
  state,
  status,
}: {
  state: SubmissionState;
  status?: string | null;
}) {
  const reached = REACHED[state];
  const settled = isSettled(state);
  const failed = state === "disrupted";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        {STAGES.map((label, index) => {
          const done = index < reached || (settled && index <= reached);
          const running = index === reached && !settled;

          return (
            <div key={label} className="flex-1 space-y-1">
              <div className="bg-surface-3 h-1 overflow-hidden rounded-full">
                <motion.div
                  className={cn(
                    "h-full origin-left rounded-full",
                    failed && index === reached ? "bg-warn" : "bg-primary",
                  )}
                  // No entrance from zero: a page opened on a settled
                  // submission should already show the finished bar.
                  initial={false}
                  animate={{
                    scaleX: done || running ? 1 : 0,
                    opacity: running ? [0.4, 1, 0.4] : 1,
                  }}
                  transition={{
                    scaleX: LAYOUT_SPRING,
                    opacity: running
                      ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
                      : { duration: 0.2 },
                  }}
                />
              </div>
              <div
                className={cn(
                  "text-[11px] transition-colors",
                  done || running ? "text-fg-muted" : "text-fg-subtle",
                )}
              >
                {label}
              </div>
            </div>
          );
        })}
      </div>

      {status && !settled ? (
        <p className="text-fg-subtle font-mono text-[11px]">{status}</p>
      ) : null}
    </div>
  );
}
