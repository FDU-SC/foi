import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * The Infra section for a whole environment: scheduling, elasticity,
 * and the configuration a real cluster asks for.
 */
export const contest = {
  slug: "cluster",
  title: "集群与平台",
  description: "调度、弹性、故障——一套真环境上的配置与答案。",

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

  problems: [],

  participants: { mode: "open" },
} satisfies ContestConfigInput;
