import type { ContestConfigInput } from "@/lib/contests/types";
import { AUDIENCE, ENTRANTS } from "./groups";

/**
 * The contest kernel tests reach for: entry is limited to one group, and its
 * problem overrides the submit throttle, so the three sources of a rate limit
 * (contest entry, problem, platform default) stay distinguishable.
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
 * Running whatever the clock says, and open to anyone. Tests that go through a
 * route — where `now` is the real clock — need one round they can always reach.
 */
export const open = {
  slug: "fixture-open",
  title: "常开轮次",

  leaderboards: [
    { id: "main", title: "排行榜", ruleset: { id: "fixture-tally" } },
  ],

  startsAt: "2020-01-01T00:00:00+08:00",
  endsAt: "2099-12-31T23:59:59+08:00",

  problems: [
    { slug: "fixture-inline", label: "A" },
    { slug: "fixture-external", label: "B" },
  ],
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

  problems: [{ slug: "fixture-gated", label: "A" }],
} satisfies ContestConfigInput;

/**
 * Covers an audience but has not started. Together with `staged` it separates
 * the two reasons a problem stays shut: nobody is in the audience, or the
 * clock has not reached it yet.
 */
export const upcoming = {
  slug: "fixture-upcoming",
  title: "未开始的轮次",

  leaderboards: [
    { id: "main", title: "排行榜", ruleset: { id: "fixture-tally" } },
  ],

  startsAt: "2099-01-01T00:00:00+08:00",
  endsAt: "2099-01-02T00:00:00+08:00",

  visibleTo: [AUDIENCE],

  problems: [{ slug: "fixture-gated", label: "A" }],
} satisfies ContestConfigInput;

/** Finished the default way: statements stay, the door closes. */
export const archived = {
  slug: "fixture-archived",
  title: "已归档的轮次",

  leaderboards: [
    { id: "main", title: "排行榜", ruleset: { id: "fixture-tally" } },
  ],

  startsAt: "2025-01-01T00:00:00+08:00",
  endsAt: "2025-01-02T00:00:00+08:00",

  problems: [{ slug: "fixture-late", label: "A" }],
} satisfies ContestConfigInput;

/** Finished, and still collecting: work lands outside every board's window. */
export const upsolve = {
  slug: "fixture-upsolve",
  title: "赛后仍收题的轮次",

  leaderboards: [
    { id: "main", title: "排行榜", ruleset: { id: "fixture-tally" } },
  ],

  startsAt: "2025-02-01T00:00:00+08:00",
  endsAt: "2025-02-02T00:00:00+08:00",

  afterEnd: { statements: true, submissions: true },

  problems: [{ slug: "fixture-late", label: "A" }],
} satisfies ContestConfigInput;

/** Finished, and sealed: it takes its problems offline with it. */
export const sealed = {
  slug: "fixture-sealed",
  title: "已封存的轮次",

  leaderboards: [
    { id: "main", title: "排行榜", ruleset: { id: "fixture-tally" } },
  ],

  startsAt: "2025-03-01T00:00:00+08:00",
  endsAt: "2025-03-02T00:00:00+08:00",

  afterEnd: { statements: false, submissions: false },

  problems: [{ slug: "fixture-late", label: "A" }],
} satisfies ContestConfigInput;
