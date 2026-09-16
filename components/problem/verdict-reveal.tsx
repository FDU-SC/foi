"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  VerdictBadge,
  type VerdictBadgeSubject,
} from "@/components/problem/verdict-badge";
import { Celebrate } from "@/components/ui/celebrate";
import { POP_SPRING } from "@/components/ui/motion";
import { describeVerdict } from "@/lib/presentation";

/**
 * A verdict badge that reacts when the verdict changes.
 *
 * For a submission being watched live, the badge is the thing the reader is
 * waiting on, and a silent swap is easy to miss. Each state gets its own key,
 * so the old badge leaves and the new one springs in.
 *
 * The reaction is chosen from the verdict's *tone*, never from the verdict
 * itself. Tone is what the content already declared for display purposes; what
 * counts as a pass is its call, not the platform's.
 */
export function VerdictReveal({
  submission,
}: {
  submission: VerdictBadgeSubject;
}) {
  const preset = submission.result
    ? describeVerdict(submission.problemSlug, submission.result)
    : null;

  const key = preset ? `verdict:${preset.short}` : `state:${submission.state}`;

  return (
    <span className="relative inline-flex">
      <AnimatePresence mode="popLayout">
        <motion.span
          key={key}
          className="inline-flex"
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{
            opacity: 1,
            scale: 1,
            x: preset?.tone === "err" ? [0, -4, 3, -2, 0] : 0,
          }}
          exit={{ opacity: 0, scale: 0.7 }}
          transition={{ ...POP_SPRING, x: { duration: 0.4, ease: "easeOut" } }}
        >
          <VerdictBadge submission={submission} />
        </motion.span>
      </AnimatePresence>

      {preset?.tone === "ok" ? <Celebrate key={key} /> : null}
    </span>
  );
}
