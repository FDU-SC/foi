import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * A finished round that keeps collecting.
 *
 * `afterEnd.submissions` reopens the problems once the clock runs out. Every
 * leaderboard still covers the official window alone, so late work is practice:
 * it never moves the ranking this round produced.
 */
export const contest = {
  slug: "demo-ctf",
  title: "演示赛 · CTF 动态分值",
  description: "已经结束，但题目仍然开放——赛后提交不计入排行榜。",

  leaderboards: [
    {
      id: "main",
      title: "排行榜",
      ruleset: {
        id: "ctf-dynamic",
        config: { initial: 500, minimum: 100, decay: 20 },
      },
    },
  ],

  startsAt: "2026-08-15T09:00:00+08:00",
  endsAt: "2026-08-16T21:00:00+08:00",

  afterEnd: { statements: true, submissions: true },

  problems: [{ slug: "leaky-bucket", label: "A" }],

  participants: { mode: "open" },
} satisfies ContestConfigInput;
