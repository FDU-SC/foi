import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * The CTF section for protocols, primitives, and the implementations
 * that let them slip.
 */
export const contest = {
  slug: "crypto",
  title: "Crypto",
  description: "密码协议、密码原语与实现漏洞。",

  domain: "CTF",
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
