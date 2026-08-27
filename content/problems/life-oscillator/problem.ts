import type { ProblemUi } from "@/content/_shared/ui/ui-config";

export const problem = {
  slug: "life-oscillator",
  title: "生命游戏 · 周期猎人",
  maxScore: 100,
  backend: { kind: "inline" as const },
  ui: {
    placeholder: "粘贴图案（. 死 / O 活），场景之间空一行",
    tags: ["提交答案", "Special Judge", "模拟", "趣味"],
    difficulty: "省选",
  } satisfies ProblemUi,
  order: 10,
};
