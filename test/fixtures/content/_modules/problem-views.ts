import type { ProblemViews } from "@/lib/problems/views";

/**
 * Keyed by slug: unlike the other tables, path parsing for views happens in
 * `_modules/`, so the platform already receives slugs here.
 *
 * One problem overrides verdict labels and the rest register nothing, which is
 * what a deployment that leaves the defaults alone looks like.
 */
export const problemViews: Record<string, ProblemViews> = {
  "fixture-inline": {
    verdicts: {
      accepted: { label: "通过", short: "AC", tone: "ok" },
      wrong_answer: { label: "答案错误", short: "WA", tone: "err" },
    },
  },
};
