import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * The CTF section for taking control of a binary: memory corruption,
 * exploitation, and privilege.
 */
export const contest = {
  slug: "pwn",
  title: "Pwn",
  description: "二进制漏洞利用、控制流劫持与权限提升。",

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
