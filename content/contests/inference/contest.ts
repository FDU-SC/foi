import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * The HPC & AI Infra section for serving a model: throughput, latency, and how
 * memory is paged once the work is a service rather than a kernel.
 */
export const contest = {
  slug: "inference",
  title: "推理与服务",
  description: "吞吐、延迟、显存分页——把模型做成服务之后怎么稳、怎么快。",

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
