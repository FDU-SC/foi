import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * Web CTF practice. The problem also belongs to `demo-ctf`, with one URL per
 * contest/problem pair. The round scores its own window; this section stays open.
 */
export const contest = {
  slug: "ctf",
  title: "Web",
  description: "Web 注入、鉴权与逻辑漏洞。",

  domain: "CTF",
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

  problems: [{ slug: "leaky-bucket" }],

  participants: { mode: "open" },
} satisfies ContestConfigInput;
