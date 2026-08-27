import type { ProblemViews } from "@/lib/problems/views";
import { CodePayloadView as PayloadView } from "@/content/_shared/views/code-payload";
import { VerdictDetail } from "@/content/_shared/views/tests-table";

export const views: ProblemViews = { PayloadView, VerdictDetail };
