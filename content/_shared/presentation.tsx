import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Presentation } from "@/lib/presentation";
import { verdicts } from "./verdicts";
import { Callout } from "./mdx/callout";
import { Constraints } from "./mdx/constraints";
import { ProblemBadges } from "./ui/problem-badges";
import { Sample } from "./mdx/sample";
import { SubmitPanel } from "./ui/submit-panel";
import { CodeInput } from "./ui/code-input";
import { FlagInput } from "./ui/flag-input";
import { TextInput } from "./ui/text-input";

export const presentation: Presentation = {
  mdxComponents: {
    Callout,
    Constraints,
    Sample,
    SubmitPanel,
    CodeInput,
    FlagInput,
    TextInput,
    Badge,
    Button,
  },
  verdicts,
  ProblemBadges,
};
