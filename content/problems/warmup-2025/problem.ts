import type { ProblemUi } from "@/content/_shared/ui/ui-config";

export const problem = {
  slug: "warmup-2025",
  title: "2025 热身赛 · 二进制中 1 的个数",
  maxScore: 100,
  backend: { kind: "inline" as const },
  ui: {
    placeholder: "每行一个答案，按场景顺序",
    tags: ["提交答案"],
    difficulty: "入门",
  } satisfies ProblemUi,
};
