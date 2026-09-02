import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * The second section under the 算法 heading, which is what makes the catalogue
 * index a grouped grid rather than a flat one.
 *
 * These problems are judged in-process or through an interactor rather than by
 * running a program against test data, so they sit apart from `basics` — the
 * work of solving them looks different, even where the subject matter overlaps.
 */
export const contest = {
  slug: "puzzles",
  title: "提交答案与交互",
  description: "本地算完把答案贴上来，或者写一个程序去和评测机对话。",

  domain: "算法",
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
    { slug: "answer-only", label: "A" },
    { slug: "game-of-life", label: "B" },
    { slug: "life-oscillator", label: "C" },
    { slug: "interactive-binary-search", label: "D" },
    { slug: "roulette-daily", label: "E" },
  ],

  participants: { mode: "open" },
} satisfies ContestConfigInput;
