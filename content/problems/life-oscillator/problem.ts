import type { ProblemUi } from "@/content/components/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";
import {
  judgeLifeOscillator,
  type LifeOscillatorConfig,
} from "../_shared/judge/life-oscillator";

export const problem = {
  slug: "life-oscillator",
  title: "生命游戏 · 周期猎人",
  maxScore: 100,
  backend: {
    kind: "inline",
    judge: judgeLifeOscillator,
    config: {
      // Special Judge：不比对固定答案，而是验证提交的图案是否满足
      // 「最小周期恰为 k」。尺寸上限与 k 见各场景，它们也是判题计算量的上界。
      cases: [
        { name: "场景 1", maxDim: 16, k: 2 },
        { name: "场景 2", maxDim: 20, k: 3 },
        { name: "场景 3", maxDim: 50, k: 4 },
      ],
    } satisfies LifeOscillatorConfig,
  },
  ui: {
    submit: "text",
    placeholder: "粘贴图案（. 死 / O 活），场景之间空一行",
    tags: ["提交答案", "Special Judge", "模拟", "趣味"],
    difficulty: "省选",
  } satisfies ProblemUi,
  order: 10,
} satisfies ProblemConfigInput;
