import "server-only";
import {
  judgeLifeOscillator,
  type LifeOscillatorConfig,
} from "@/content/_shared/judges/life-oscillator";
import type { InlineJudge } from "@/lib/problems/types";

export const judge: InlineJudge = judgeLifeOscillator;

export const config = {
  cases: [
    { name: "场景 1", maxDim: 16, k: 2 },
    { name: "场景 2", maxDim: 20, k: 3 },
    { name: "场景 3", maxDim: 50, k: 4 },
  ],
} satisfies LifeOscillatorConfig;
