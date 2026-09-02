import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * A catalogue section: a contest whose window never closes.
 *
 * A problem is reachable only as part of a contest, so "just let people work on
 * these whenever" is expressed the same way everything else is — as a round
 * that happens to run for a very long time. `site.catalogue` names this one, so
 * its problems answer at `/problems/graphs/<slug>` rather than under
 * `/contests`, and `domain` groups its card with the other 算法与数据结构
 * sections there.
 */
export const contest = {
  slug: "graphs",
  title: "图论",
  description: "最短路、连通性、支配关系——把问题画成点和边之后该怎么走。",

  domain: "算法与数据结构",

  // Difficulty and tags come from each problem's `ui`; naming them here is what
  // makes this section offer them as filters and show them as badges.
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
    { slug: "maze-runner" },
    { slug: "shortest-path" },
    { slug: "dominator-tree" },
  ],

  participants: { mode: "open" },
} satisfies ContestConfigInput;
