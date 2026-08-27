import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Presentation } from "@/lib/presentation";
import { verdicts } from "../verdicts";
import { Callout } from "./callout";
import { Constraints } from "./constraints";
import { ProblemBadges } from "./problem-badges";
import { Sample } from "./sample";
import { SubmitPanel } from "./submit-panel";

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
