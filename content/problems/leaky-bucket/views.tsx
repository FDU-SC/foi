import type { ProblemViews } from "@/lib/problems/views";
import { FlagPayloadView as PayloadView } from "@/content/_shared/views/flag-payload";
import { VerdictDetail } from "@/content/_shared/views/tests-table";
import { verdicts } from "@/content/_shared/verdicts";
import { ProblemBadges } from "@/content/_shared/ui/problem-badges";

export const views: ProblemViews = { PayloadView, VerdictDetail, verdicts, Badges: ProblemBadges };
