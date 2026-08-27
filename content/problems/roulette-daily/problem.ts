import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";
import {
  judgeRoulette,
  type RouletteConfig,
} from "@/content/_shared/judges/roulette";

export const problem = {
  slug: "roulette-daily",
  title: "每日轮盘 · 签到",
  maxScore: 100,
  backend: {
    kind: "inline",
    judge: judgeRoulette,
    config: {

      scoreNumber: 100,
      scoreColor: 30,
      scoreSize: 10,
    } satisfies RouletteConfig,
  },
  ui: {
    placeholder: "red / black / green / 0-36 / big / small",
    tags: ["签到", "运气"],
  } satisfies ProblemUi,
  submit: {

    rateLimit: { max: 1, windowSeconds: 86400 },
  },
  order: 6,
} satisfies ProblemConfigInput;
