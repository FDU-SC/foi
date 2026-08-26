import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Presentation } from "@/lib/presentation";
import { verdicts } from "../verdicts";
import { Callout } from "./callout";
import { Constraints } from "./constraints";
import { ProblemBadges } from "./problem-badges";
import { Sample } from "./sample";
import { SubmitPanel } from "./submit-panel";

/**
 * What this deployment renders for the whole site.
 *
 * Three things, all of them genuinely site-wide: the vocabulary every
 * statement writes in, what this competition calls each verdict status, and
 * how a problem is labelled wherever one is listed. How one problem's payload
 * or `verdict.detail` is drawn is not here — that belongs to the problem, in
 * `content/problems/<slug>/views.tsx`.
 *
 * Keep `mdxComponents` small: widely used primitives only. Anything specific
 * to a single problem belongs in that problem's own directory and gets
 * imported directly by its statement.
 */
export const presentation: Presentation = {
  mdxComponents: {
    Callout,
    Constraints,
    Sample,
    SubmitPanel,
    Badge,
    Button,
  },
  verdicts,
  ProblemBadges,
};
