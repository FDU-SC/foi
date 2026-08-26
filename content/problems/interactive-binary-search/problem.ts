import type { ProblemUi } from "@/content/components/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

export const problem = {
  slug: "interactive-binary-search",
  title: "交互题示例 · 猜数",
  maxScore: 100,
  backend: {
    id: "interactive",
    config: {
      // mode 标记告诉评测机这是一道交互题，走拼接 grader 的评测路径。
      mode: "interactive",
      // 答案由 seed 在评测机内部生成，选手不可见。
      n: 1_000_000,
      maxQueries: 30,
      seed: 42,
      timeLimitMs: 2000,
    },
  },
  ui: {
    submit: "code",
    languages: ["cpp"],
    placeholder: "实现 void solve()，可调用 query() 与 answer()",
    tags: ["交互", "二分", "示例"],
    difficulty: "入门",
  } satisfies ProblemUi,
  order: 4,
} satisfies ProblemConfigInput;
