import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * The HPC & AI Infra section for the layer above kernels: dispatch, compilation,
 * and how a framework schedules work onto devices.
 */
export const contest = {
  slug: "framework",
  title: "框架与运行时",
  description:
    "框架的算子调度、编译与显存分配。",

  domain: "HPC & AI Infra",
  facets: ["difficulty", "tags"],

  leaderboards: [
    {
      id: "main",
      title: "总分榜",
      ruleset: { id: "practice" },
    },
  ],

  startsAt: "2025-01-01T00:00:00+08:00",
  endsAt: "2099-12-31T23:59:59+08:00",

  problems: [],

  participants: { mode: "open" },
} satisfies ContestConfigInput;
