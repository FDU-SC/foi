import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * The CTF section for everything that is not Web, Pwn, Reverse, or Crypto.
 */
export const contest = {
  slug: "misc",
  title: "Misc",
  description: "编码、取证、奇怪的题——其余都放这里。",

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
