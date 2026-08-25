import type { ProblemUi } from "@/content/components/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";
import {
  judgeOutputOnly,
  type OutputOnlyConfig,
} from "../_shared/judge/output-only";

export const problem = {
  slug: "answer-only",
  title: "提交答案题示例 · 二进制中 1 的个数",
  maxScore: 100,
  backend: {
    kind: "inline",
    judge: judgeOutputOnly,
    config: {
      // 期望答案按场景顺序。真实场景下这些数据由评测机从 testdata 读取，
      // 示例题直接内联——反正 backend.config 不会下发到浏览器。
      cases: [
        { name: "场景 1", expected: "8" },
        { name: "场景 2", expected: "1" },
        { name: "场景 3", expected: "16" },
      ],
    } satisfies OutputOnlyConfig,
  },
  ui: { submit: "text", placeholder: "每行一个答案，按场景顺序" } satisfies ProblemUi,
  tags: ["提交答案", "示例"],
  difficulty: "入门",
  order: 3,
} satisfies ProblemConfigInput;
