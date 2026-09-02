import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * A catalogue section: a contest whose window never closes.
 *
 * A problem is reachable only as part of a contest, so "just let people work on
 * these whenever" is expressed the same way everything else is — as a round
 * that happens to run for a very long time. `site.catalogue` names this one, so
 * its problems answer at `/problems/basics/<slug>` rather than under
 * `/contests`, and `domain` puts its card under the 算法 heading there.
 */
export const contest = {
  slug: "basics",
  title: "算法基础",
  description: "图论、递归、搜索——写题的基本功。随时提交，按总分排名。",

  domain: "算法",

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
    { slug: "maze-runner", label: "A" },
    { slug: "hanoi-kth", label: "B" },
    { slug: "dominator-tree", label: "C" },
  ],

  participants: { mode: "open" },
} satisfies ContestConfigInput;
