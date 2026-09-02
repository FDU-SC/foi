import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * The section for problems that are light rather than hard.
 *
 * Cellular automata, a daily roulette, and one example of what an interactive
 * problem looks like. None of them is judged by running a program against test
 * data, and none of them is meant to be ground through — which is why they sit
 * under a heading of their own rather than among the 算法与数据结构 sections.
 */
export const contest = {
  slug: "puzzles",
  title: "玩具箱",
  description:
    "生命游戏、每日轮盘，外加一道演示交互题怎么写的示例——随手玩玩，不必较真。",

  domain: "娱乐",
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
    { slug: "game-of-life", label: "A" },
    { slug: "life-oscillator", label: "B" },
    { slug: "interactive-binary-search", label: "C" },
    { slug: "roulette-daily", label: "D" },
  ],

  participants: { mode: "open" },
} satisfies ContestConfigInput;
