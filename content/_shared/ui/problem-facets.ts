import type { PublicProblemConfig } from "@/lib/problems/types";
import type { ProblemFacet } from "@/lib/problems/views";
import { problemUi } from "./ui-config";

/**
 * The difficulty ladder, easiest first. A page lists the values in this order;
 * a problem carrying anything else lands after them.
 *
 * Three rungs rather than a competition ladder: difficulty is a judgement call,
 * and the more rungs there are the less two people agree on which one a problem
 * sits on. It spans every domain this deployment carries, so it says how hard
 * the problem is and nothing about what kind of problem it is.
 */
export const DIFFICULTIES = ["入门", "进阶", "挑战"];

/** Which of a problem's `ui` fields become dimensions a contest may offer. */
export function problemFacets(config: PublicProblemConfig): ProblemFacet[] {
  const ui = problemUi(config);

  return [
    {
      key: "difficulty",
      label: "难度",
      values: ui.difficulty ? [ui.difficulty] : [],
      order: DIFFICULTIES,
    },
    { key: "tags", label: "标签", values: ui.tags },
  ];
}
