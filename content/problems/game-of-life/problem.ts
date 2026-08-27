import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";
import {
  judgeOutputOnly,
  type OutputOnlyConfig,
} from "@/content/_shared/judges/output-only";

export const problem = {
  slug: "game-of-life",
  title: "生命游戏 · 第一百代",
  maxScore: 100,
  backend: {
    kind: "inline",
    judge: judgeOutputOnly,
    config: {

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
    tags: ["提交答案", "模拟", "趣味"],
    difficulty: "入门",
  } satisfies ProblemUi,
  order: 8,
} satisfies ProblemConfigInput;
