import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";
import {
  judgeOutputOnly,
  type OutputOnlyConfig,
} from "@/content/_shared/judges/output-only";

export const problem = {
  slug: "answer-only",
  title: "提交答案题示例 · 二进制中 1 的个数",
  maxScore: 100,
  backend: {
    kind: "inline",
    judge: judgeOutputOnly,
    config: {

      cases: [
        { name: "场景 1", expected: "8" },
        { name: "场景 2", expected: "1" },
        { name: "场景 3", expected: "16" },
      ],
    } satisfies OutputOnlyConfig,
  },
  ui: {
    submit: "text",
    placeholder: "每行一个答案，按场景顺序",
    tags: ["提交答案", "示例"],
    difficulty: "入门",
  } satisfies ProblemUi,
  order: 3,
} satisfies ProblemConfigInput;
