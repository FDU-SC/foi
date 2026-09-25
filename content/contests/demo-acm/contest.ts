import type { ContestConfigInput } from "@/lib/contests/types";

export const contest = {
  slug: "demo-acm",
  title: "演示赛 · ACM 赛制",

  leaderboards: [
    {
      id: "main",
      title: "排行榜",
      ruleset: { id: "acm", config: { penaltyMinutes: 20 } },
    },
  ],

  startsAt: "2026-08-01T13:00:00+08:00",
  endsAt: "2026-08-01T18:00:00+08:00",

  problems: [
    {
      slug: "maze-runner",
      label: "A",
      rateLimit: { max: 30, windowSeconds: 60 },
    },
    { slug: "hanoi-kth", label: "B" },
    { slug: "dominator-tree", label: "C" },
  ],

  participants: { mode: "group", group: "demo" },
} satisfies ContestConfigInput;
