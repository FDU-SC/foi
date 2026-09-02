import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * The catalogue: a contest whose window never closes.
 *
 * A problem is reachable only as part of a contest, so "just let people work on
 * these whenever" is expressed the same way everything else is — as a round
 * that happens to run for a very long time. `site.catalogue` names this one, so
 * its problems answer at `/problems/<slug>` rather than under `/contests`.
 */
export const contest = {
  slug: "practice",
  title: "题库",
  description: "长期开放的题目都在这里。随时提交，按总分排名。",

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
    { slug: "maze-runner", label: "A" },
    { slug: "hanoi-kth", label: "B" },
    { slug: "dominator-tree", label: "C" },
    { slug: "answer-only", label: "D" },
    { slug: "game-of-life", label: "E" },
    { slug: "life-oscillator", label: "F" },
    { slug: "interactive-binary-search", label: "G" },
    { slug: "perf-optimize", label: "H" },
    { slug: "roulette-daily", label: "I" },
  ],

  participants: { mode: "open" },
} satisfies ContestConfigInput;
