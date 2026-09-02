import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

export const problem = {
  slug: "knapsack",
  title: "0-1 背包",
  maxScore: 100,
  backend: {
    id: "traditional",
    config: {
      timeLimit: 1000,
      memoryLimit: 256,
      testdata: "knapsack/v1",
      subtasks: [
        { name: "可以爆搜", score: 30 },
        { name: "小容量", score: 30 },
        { name: "大数据", score: 40 },
      ],
    },
  },
  ui: {
    languages: ["cpp", "python", "java"],
    tags: ["动态规划"],
    difficulty: "进阶",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;
