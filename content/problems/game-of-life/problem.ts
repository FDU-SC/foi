import type { ProblemUi } from "@/content/_shared/ui/ui-config";

export const problem = {
  slug: "game-of-life",
  title: "生命游戏 · 第一百代",
  maxScore: 100,
  backend: { kind: "inline" as const },
  ui: {
    placeholder: "每行一个答案，按场景顺序",
    tags: ["提交答案", "模拟", "趣味"],
    difficulty: "入门",
  } satisfies ProblemUi,
};
