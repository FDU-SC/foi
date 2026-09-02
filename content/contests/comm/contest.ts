import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * The HPC & AI Infra section whose work is moving data between processes:
 * collective communication, parallel plans, compute/communication overlap.
 */
export const contest = {
  slug: "comm",
  title: "分布式与通信",
  description:
    "集合通信、并行切分、计算与通信 overlap——多进程之间怎么把数据搬走。",

  domain: "HPC & AI Infra",
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

  problems: [],

  participants: { mode: "open" },
} satisfies ContestConfigInput;
