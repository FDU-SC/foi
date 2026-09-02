import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * The 算法与数据结构 section for problems that split into smaller copies of
 * themselves, where the answer comes out of what the split leaves behind.
 */
export const contest = {
  slug: "divide-and-conquer",
  title: "递归与分治",
  description: "把问题拆成同样形状的小问题，答案藏在拆开的那一刀上。",

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
    { slug: "hanoi-kth" },
    { slug: "inversions" },
  ],

  participants: { mode: "open" },
} satisfies ContestConfigInput;
