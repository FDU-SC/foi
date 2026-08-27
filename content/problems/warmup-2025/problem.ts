import type { ProblemUi } from "@/content/components/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";
import {
  judgeOutputOnly,
  type OutputOnlyConfig,
} from "../_shared/judge/output-only";

export const problem = {
  slug: "warmup-2025",
  title: "2025 热身赛 · 二进制中 1 的个数（已下架）",
  maxScore: 100,
  retired: true,

  backend: {
    kind: "inline",
    judge: judgeOutputOnly,
    config: {
      cases: [
        { name: "场景 1", expected: "8" },
        { name: "场景 2", expected: "1" },
      ],
    } satisfies OutputOnlyConfig,
  },
  ui: {
    submit: "text",
    placeholder: "每行一个答案，按场景顺序",
    tags: ["提交答案", "示例"],
    difficulty: "入门",
  } satisfies ProblemUi,
  order: 99,
} satisfies ProblemConfigInput;
