import type { ProblemUi } from "@/content/components/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

export const problem = {
  slug: "hanoi-kth",
  title: "汉诺塔 · 第 k 步",
  maxScore: 100,
  backend: {
    id: "traditional",
    config: {
      timeLimit: 1000,
      memoryLimit: 256,
      testdata: "hanoi-kth/v1",
      subtasks: [
        { name: "小数据", score: 30 },
        { name: "中等数据", score: 30 },
        { name: "大数据", score: 40 },
      ],
    },
  },
  ui: {
    submit: "code",
    languages: ["cpp", "python"],
    tags: ["递归", "分治", "趣味"],
    difficulty: "普及",
  } satisfies ProblemUi,
  order: 9,
} satisfies ProblemConfigInput;
