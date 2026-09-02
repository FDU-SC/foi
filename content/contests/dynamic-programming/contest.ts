import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * The 算法与数据结构 section where the work is finding a state and a transition:
 * once those two are right, the code is a couple of loops.
 */
export const contest = {
  slug: "dynamic-programming",
  title: "动态规划",
  description: "定义状态，写出转移——从一维序列开始，练到背包。",

  domain: "算法与数据结构",
  facets: ["difficulty", "tags"],

  leaderboards: [
    {
      id: "main",
      title: "总分榜",
      ruleset: { id: "oi", config: { take: "best" } },
    },
  ],

  startsAt: "2025-01-01T00:00:00+08:00",
  endsAt: "2099-12-31T23:59:59+08:00",

  problems: [
    { slug: "lis" },
    { slug: "knapsack" },
  ],

  participants: { mode: "open" },
} satisfies ContestConfigInput;
