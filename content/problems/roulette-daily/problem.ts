import type { ProblemUi } from "@/content/_shared/ui/ui-config";

export const problem = {
  slug: "roulette-daily",
  title: "每日轮盘 · 签到",
  maxScore: 100,
  backend: { kind: "inline" as const },
  ui: {
    placeholder: "red / black / green / 0-36 / big / small",
    tags: ["签到", "运气"],
  } satisfies ProblemUi,
  submit: {
    rateLimit: { max: 1, windowSeconds: 86400 },
  },
  order: 6,
  addedAt: "2026-07-09T10:00:00+08:00",
};
