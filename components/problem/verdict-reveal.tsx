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
 * Animate verdict changes using keyed badges. Choose effects from the
 * content-provided tone; the platform must not interpret verdicts as pass/fail.
 */
export function VerdictReveal({
  submission,
}: {
  submission: VerdictBadgeSubject;
}) {
  const preset = submission.result != null
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
