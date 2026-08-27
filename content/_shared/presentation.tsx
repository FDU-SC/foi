import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Presentation } from "@/lib/presentation";
import { verdicts } from "./verdicts";
import { Callout } from "./mdx/callout";
import { Constraints } from "./mdx/constraints";
import { ProblemBadges } from "./ui/problem-badges";
import { Sample } from "./mdx/sample";
import { SubmitPanel } from "./ui/submit-panel";

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
