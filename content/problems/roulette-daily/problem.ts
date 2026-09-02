import type { ProblemUi } from "@/content/_shared/ui/ui-config";

export const problem = {
  slug: "roulette-daily",
  title: "每日轮盘 · 签到",
  maxScore: 100,
  backend: { kind: "inline" as const },
  ui: {
    placeholder: "red / black / green / 0-36 / big / small",
    tags: ["签到"],
  } satisfies ProblemUi,
  submit: {
    rateLimit: { max: 1, windowSeconds: 86400 },
  },
};
