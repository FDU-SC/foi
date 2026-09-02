import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

export const problem = {
  slug: "range-sum",
  title: "区间求和",
  maxScore: 100,
  backend: {
    id: "traditional",
    config: {
      timeLimit: 1000,
      memoryLimit: 256,
      testdata: "range-sum/v1",
      subtasks: [
        { name: "暴力可过", score: 30 },
        { name: "没有修改", score: 30 },
        { name: "大数据", score: 40 },
      ],
    },
  },
  ui: {
    languages: ["cpp", "python", "java"],
    tags: ["树状数组", "线段树"],
    difficulty: "进阶",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;
