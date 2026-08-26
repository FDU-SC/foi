import type { ProblemUi } from "@/content/components/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";
import {
  judgeRoulette,
  type RouletteConfig,
} from "../_shared/judge/roulette";

export const problem = {
  slug: "roulette-daily",
  title: "每日轮盘 · 签到",
  maxScore: 100,
  backend: {
    kind: "inline",
    judge: judgeRoulette,
    config: {
      // 结果由 HMAC(AUTH_SECRET, handle|日期) 派生：每人每天一个私有轮盘，
      // 选手算不出来，服务端不用存。押中数字 100 分 / 颜色 30 分 / 大小 10 分。
      scoreNumber: 100,
      scoreColor: 30,
      scoreSize: 10,
    } satisfies RouletteConfig,
  },
  ui: {
    submit: "text",
    placeholder: "red / black / green / 0-36 / big / small",
    tags: ["签到", "运气"],
  } satisfies ProblemUi,
  submit: {
    // 签到：约 24 小时可以来一次。
    rateLimit: { max: 1, windowSeconds: 86400 },
  },
  order: 6,
} satisfies ProblemConfigInput;
