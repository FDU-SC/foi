import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

export const problem = {
  slug: "largest-rectangle",
  title: "最大矩形",
  maxScore: 100,
  backend: {
    id: "traditional",
    config: {
      timeLimit: 1000,
      memoryLimit: 256,
      testdata: "largest-rectangle/v1",
      subtasks: [
        { name: "平方做法可过", score: 30 },
        { name: "中等数据", score: 30 },
        { name: "大数据", score: 40 },
      ],
    },
  },
  ui: {
    languages: ["cpp", "python", "java"],
    tags: ["单调栈"],
    difficulty: "挑战",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;
