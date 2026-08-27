import "server-only";
import {
  judgeOutputOnly,
  type OutputOnlyConfig,
} from "@/content/_shared/judges/output-only";
import type { InlineJudge } from "@/lib/problems/types";

export const judge: InlineJudge = judgeOutputOnly;

export const config = {
  cases: [
    { name: "场景 1", expected: "8" },
    { name: "场景 2", expected: "1" },
    { name: "场景 3", expected: "16" },
  ],
} satisfies OutputOnlyConfig;
