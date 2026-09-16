import type { PublicProblemConfig } from "@/lib/problems/types";
import type { ProblemFacet } from "@/lib/problems/views";
import { problemUi } from "./ui-config";

/**
 * Three difficulty levels shared across domains, easiest first. Values absent
 * from this list sort last. Difficulty describes complexity, not problem type.
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
