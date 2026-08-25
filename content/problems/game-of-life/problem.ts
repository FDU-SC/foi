import type { ProblemUi } from "@/content/components/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";
import {
  judgeOutputOnly,
  type OutputOnlyConfig,
} from "../_shared/judge/output-only";

export const problem = {
  slug: "game-of-life",
  title: "生命游戏 · 第一百代",
  maxScore: 100,
  backend: {
    kind: "inline",
    judge: judgeOutputOnly,
    config: {
      // 第 100 代活细胞数（用程序模拟得到，手算不现实）。
      cases: [
        { name: "场景 1", expected: "14" },
        { name: "场景 2", expected: "12" },
        { name: "场景 3", expected: "14" },
      ],
    } satisfies OutputOnlyConfig,
  },
  ui: {
    submit: "text",
    placeholder: "每行一个答案，按场景顺序",
  } satisfies ProblemUi,
  tags: ["提交答案", "模拟", "趣味"],
  difficulty: "入门",
  order: 8,
} satisfies ProblemConfigInput;
