import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * The 算法与数据结构 section where the difficulty sits in what you keep rather
 * than in what you compute — a disjoint set, a Fenwick tree, a monotonic stack.
 */
export const contest = {
  slug: "data-structures",
  title: "数据结构",
  description: "并查集、树状数组、单调栈——用对的结构存住信息，查询才便宜。",

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
    { slug: "disjoint-set", label: "A" },
    { slug: "range-sum", label: "B" },
    { slug: "largest-rectangle", label: "C" },
  ],

  participants: { mode: "open" },
} satisfies ContestConfigInput;
