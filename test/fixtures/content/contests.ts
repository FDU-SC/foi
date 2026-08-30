import type { ContestConfigInput } from "@/lib/contests/types";
import { ENTRANTS } from "./groups";

/**
 * The contest kernel tests reach for: entry is limited to one group, and its
 * only problem overrides the submit throttle, so the three sources of a rate
 * limit (contest entry, problem, platform default) stay distinguishable.
 *
 * Its window is fixed in the past. Tests that need a moment inside or after it
 * derive one from `startsAt` / `endsAt` rather than from the clock.
 */
export const main = {
  slug: "fixture-main",
  title: "夹具赛",
  description: "内核测试用的比赛。",

  leaderboards: [
    {
      id: "main",
      title: "排行榜",
      ruleset: { id: "fixture-tally", config: {} },
    },
  ],

  startsAt: "2026-06-01T13:00:00+08:00",
  endsAt: "2026-06-01T18:00:00+08:00",

  problems: [
    {
      slug: "fixture-external",
      label: "A",
      rateLimit: { max: 30, windowSeconds: 60 },
    },
  ],

  participants: { mode: "group", group: ENTRANTS },
} satisfies ContestConfigInput;

/**
 * Visible to nobody. Proves that preview reaches rounds no audience covers —
 * without it, "everyone sees everything" would pass the same assertions.
 */
export const staged = {
  slug: "fixture-staged",
  title: "暂存轮次",

  leaderboards: [
    { id: "main", title: "排行榜", ruleset: { id: "fixture-tally" } },
  ],

  startsAt: "2026-01-01T00:00:00+08:00",
  endsAt: "2026-01-02T00:00:00+08:00",

  visibleTo: [],
} satisfies ContestConfigInput;
