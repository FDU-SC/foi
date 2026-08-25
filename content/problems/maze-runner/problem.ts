import type { ProblemUi } from "@/content/components/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

export const problem = {
  slug: "maze-runner",
  title: "迷宫寻路",
  maxScore: 100,
  backend: {
    id: "traditional",
    config: {
      timeLimit: 1000,
      memoryLimit: 256,
      testdata: "maze-runner/v1",
      subtasks: [
        { name: "小数据", score: 30 },
        { name: "中等数据", score: 30 },
        { name: "大数据", score: 40 },
      ],
    },
  },
  ui: { submit: "code", languages: ["cpp", "python", "java"] } satisfies ProblemUi,
  tags: ["BFS", "图论", "最短路"],
  difficulty: "普及",
  order: 1,
} satisfies ProblemConfigInput;
