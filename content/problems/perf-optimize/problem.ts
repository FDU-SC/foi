import type { ProblemUi } from "@/content/components/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

export const problem = {
  slug: "perf-optimize",
  title: "性能优化题示例 · 矩阵乘法",
  maxScore: 100,
  backend: {
    id: "performance",
    config: {
      // mode 标记告诉评测机这是一道性能题：编译运行 + 与内置基线对比计时。
      mode: "performance",
      n: 512,
      warmupRuns: 1,
      timedRuns: 3,
      timeLimitMs: 8000,
      compileFlags: "-O2 -std=c++17",
    },
  },
  ui: {
    submit: "code",
    languages: ["cpp"],
    placeholder: "粘贴你的优化代码（完整程序，读入矩阵并输出乘积）",
    tags: ["性能优化", "HPC", "示例"],
    difficulty: "省选",
  } satisfies ProblemUi,
  order: 5,
} satisfies ProblemConfigInput;
