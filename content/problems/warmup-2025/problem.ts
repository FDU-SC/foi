import type { ProblemUi } from "@/content/_shared/ui/ui-config";

export const problem = {
  slug: "warmup-2025",
  title: "2025 热身赛 · 二进制中 1 的个数（已下架）",
  maxScore: 100,
  retired: true,
  backend: { kind: "inline" as const },
  ui: {
    placeholder: "每行一个答案，按场景顺序",
    tags: ["提交答案", "示例"],
    difficulty: "入门",
  } satisfies ProblemUi,
  order: 99,
};
