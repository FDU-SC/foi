import type { ProblemViews } from "@/lib/problems/views";
import { TextPayloadView as PayloadView } from "@/content/_shared/views/text-payload";
import { verdicts } from "@/content/_shared/verdicts";
import { ProblemBadges } from "@/content/_shared/ui/problem-badges";
import { problemFacets } from "@/content/_shared/ui/problem-facets";

export const views: ProblemViews = {
  PayloadView,
  verdicts,
  Badges: ProblemBadges,
  facets: problemFacets,
};
