import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * The CTF section for web challenges.
 *
 * Its problem also belongs to the `demo-ctf` round, so the same problem holds
 * two URLs — one per pair. That is the intended shape: a round's copy is scored
 * inside that round's window, and this one stays open for practice.
 */
export const contest = {
  slug: "ctf",
  title: "Web",
  description: "注入、鉴权、逻辑漏洞——对着站点把不该给你的东西拿出来。",

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
