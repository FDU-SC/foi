import type { Presentation } from "@/lib/presentation/types";
import { Callout, Constraints } from "./statement";
import { SubmitPanel } from "./submit-panel";

/**
 * What this content renders for the whole site.
 *
 * One of the two slots is filled and one is not. There is no `verdicts`, so
 * every status a backend reports renders as its own string with a colour
 * `describeVerdict` derives from the score — which is what that fallback is
 * for, and it only gets exercised if some content declines to name any.
 *
 * How a payload or a `verdict.detail` is drawn is not here: that belongs to
 * the problem, in `views.tsx` beside its `problem.ts`. The skeleton fills it
 * on one problem out of three.
 */
export const presentation: Presentation = {
  mdxComponents: {
    Callout,
    Constraints,
    SubmitPanel,
  },
};
