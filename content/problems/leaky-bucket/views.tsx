import type { ProblemViews } from "@/lib/problems/views";
import { FlagPayloadView as PayloadView } from "@/content/_shared/views/flag-payload";
import { VerdictDetail } from "@/content/_shared/views/tests-table";

export const views: ProblemViews = { PayloadView, VerdictDetail };
