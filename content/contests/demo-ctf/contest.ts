import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * `afterEnd.submissions` allows post-contest practice without affecting
 * leaderboards, which score only the official contest window.
 */
export const contest = {
  slug: "demo-ctf",
  title: "演示赛 · CTF 动态分值",
  description: "比赛已结束，题目仍可提交；赛后提交不计入排行榜。",

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

  afterEnd: { statements: false, submissions: false },

  problems: [{ slug: "leaky-bucket", label: "A" }],

  participants: { mode: "open" },
} satisfies ContestConfigInput;
