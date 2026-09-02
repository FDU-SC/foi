import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

export const problem = {
  slug: "inversions",
  title: "逆序对",
  maxScore: 100,
  backend: {
    id: "traditional",
    config: {
      timeLimit: 1000,
      memoryLimit: 256,
      testdata: "inversions/v1",
      subtasks: [
        { name: "平方做法可过", score: 30 },
        { name: "中等数据", score: 30 },
        { name: "大数据", score: 40 },
      ],
    },
  },
  ui: {
    languages: ["cpp", "python", "java"],
    tags: ["分治", "归并排序"],
    difficulty: "进阶",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;
