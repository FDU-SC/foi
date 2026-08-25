import type { ProblemUi } from "@/content/components/ui-config";
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
  ui: { submit: "code", languages: ["cpp", "python"] } satisfies ProblemUi,
  tags: ["图论", "支配树", "Lengauer-Tarjan"],
  difficulty: "NOI",
  order: 7,
} satisfies ProblemConfigInput;
