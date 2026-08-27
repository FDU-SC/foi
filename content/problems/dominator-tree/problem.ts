import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

export const problem = {
  slug: "dominator-tree",
  title: "必经之路",
  maxScore: 100,
  backend: {
    id: "traditional",
    config: {
      timeLimit: 3000,
      memoryLimit: 512,
      testdata: "dominator-tree/v1",
      subtasks: [
        { name: "小数据", score: 30 },
        { name: "中等数据", score: 30 },
        { name: "大数据", score: 40 },
      ],
    },
  },
  ui: {
    languages: ["cpp", "python"],
    tags: ["图论", "支配树", "Lengauer-Tarjan"],
    difficulty: "NOI",
  } satisfies ProblemUi,
  order: 7,
} satisfies ProblemConfigInput;
