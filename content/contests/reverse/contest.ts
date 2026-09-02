import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * The CTF section for reading a program that did not want to be read.
 */
export const contest = {
  slug: "reverse",
  title: "Reverse",
  description: "拆开别人的程序，看它在藏什么。",

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

  problems: [],

  participants: { mode: "open" },
} satisfies ContestConfigInput;
