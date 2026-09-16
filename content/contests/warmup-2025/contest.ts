import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * Default post-contest access: statements remain readable and submissions close
 * (`afterEnd.statements: true`, `afterEnd.submissions: false`).
 */
export const contest = {
  slug: "warmup-2025",
  title: "2025 热身赛",
  description: "比赛已结束，题面可查看，提交已关闭。",

  leaderboards: [
    {
      id: "main",
      title: "排行榜",
      ruleset: { id: "acm", config: { penaltyMinutes: 20 } },
    },
  ],

  startsAt: "2025-09-01T13:00:00+08:00",
  endsAt: "2025-09-01T16:00:00+08:00",

  problems: [{ slug: "warmup-2025", label: "A" }],

  participants: { mode: "open" },
} satisfies ContestConfigInput;
