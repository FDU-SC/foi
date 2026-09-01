import type { PublicProblemConfig } from "@/lib/problems/types";
import type { ProblemFacet } from "@/lib/problems/views";
import { problemUi } from "./ui-config";

/**
 * The difficulty ladder, easiest first. The catalogue lists the values in this
 * order; a problem carrying anything else lands after them.
 */
export const DIFFICULTIES = ["入门", "普及", "省选", "NOI"];

/** Which of a problem's `ui` fields the catalogue offers as filters. */
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
