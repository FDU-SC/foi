import type { ProblemConfigInput } from "@/lib/problems/types";

export const problem = {
  slug: "roulette-daily",
  title: "每日轮盘 · 签到",
  maxScore: 100,
  backend: {
    id: "roulette",
    config: {
      // 结果由日期决定：同一天所有人都面对同一个轮盘。
      // 押中数字 100 分 / 颜色 30 分 / 大小 10 分。
      mode: "roulette",
      scoreNumber: 100,
      scoreColor: 30,
      scoreSize: 10,
    },
  },
  submit: {
    kind: "text",
    placeholder: "red / black / green / 0-36 / big / small",
    // 签到：约 24 小时可以来一次。
    rateLimit: { max: 1, windowSeconds: 86400 },
  },
  tags: ["签到", "运气"],
  order: 6,
} satisfies ProblemConfigInput;
