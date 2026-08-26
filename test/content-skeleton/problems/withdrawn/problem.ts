import type { ProblemConfigInput } from "@/lib/problems/types";

/**
 * Out of service, and still readable.
 *
 * The two axes cross — `retired` is not a second spelling of `visibleTo: []` —
 * and the row that proves it is this one: somebody who competed on a problem
 * should still be able to open it afterwards, and the round it belonged to
 * should still render its standings.
 *
 * Inline rather than dispatched so the skeleton needs no second backend, and
 * with no `ui.submit` panel in the statement because there is nothing to send.
 */
export const problem = {
  slug: "withdrawn",
  title: "已下架的示例题",
  maxScore: 100,
  backend: {
    kind: "inline",
    judge: () => ({ unavailable: true, reason: "这道题已经下架" }),
  },
  ui: { submit: "none" },
  retired: true,
  order: 3,
} satisfies ProblemConfigInput;
