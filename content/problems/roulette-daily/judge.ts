import "server-only";
import {
  judgeRoulette,
  type RouletteConfig,
} from "@/content/_shared/judges/roulette";
import type { InlineJudge } from "@/lib/problems/types";

export const judge: InlineJudge = judgeRoulette;

export const config = {
  scoreNumber: 100,
  scoreColor: 30,
  scoreSize: 10,
} satisfies RouletteConfig;
