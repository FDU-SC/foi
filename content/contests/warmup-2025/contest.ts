import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * A finished round that keeps its statements and closes its door.
 *
 * This is the default afterlife: `afterEnd.statements` stays true so whoever
 * competed can still read what they solved, while `afterEnd.submissions` stays
 * false so the round takes no more work.
 */
export const contest = {
  slug: "warmup-2025",
  title: "2025 热身赛",
  description: "已经结束。题面留着供回看，提交入口已经关闭。",

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
