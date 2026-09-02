import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * The Infra heading's first section: single-node, single-device performance.
 *
 * Its problems are scored against a baseline rather than checked for
 * correctness alone, which is why the section boundary and the judging
 * environment line up — everything here goes through the `performance` backend.
 */
export const contest = {
  slug: "kernel",
  title: "算子与 Kernel",
  description: "访存、向量化、并行——把一段计算跑得更快，按相对基线的加速比计分。",

  domain: "Infra",
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

  problems: [{ slug: "perf-optimize" }],

  participants: { mode: "open" },
} satisfies ContestConfigInput;
