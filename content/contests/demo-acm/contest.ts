import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * The worked example for a contest, and the one `content/demo-data.sql`
 * attributes its seeded submissions to.
 *
 * It deliberately references only `maze-runner`: this directory is on the
 * public mirror's allowlist, and every other problem in the repository carries
 * answer material that must not leave. Real contests go in sibling
 * directories, which stay private by default.
 *
 * The window is in the past so the standings have something final to show
 * straight after `pnpm db:seed`.
 */
export const contest = {
  slug: "demo-acm",
  title: "演示赛 · ACM 赛制",
  description: "用于演示排行榜与赛制渲染的示例比赛。",

  ruleset: {
    id: "acm",
    config: { penaltyMinutes: 20 },
  },

  startsAt: "2026-08-01T13:00:00+08:00",
  endsAt: "2026-08-01T18:00:00+08:00",

  // `rateLimit` overrides what the problem says about itself, for this round
  // only — the same relationship `points` has with the problem's `maxScore`.
  // ACM already discourages guessing with penalty minutes, so this is loose;
  // a round scored OI, where only the last submission counts and resubmitting
  // is free, is where a tighter number earns its keep.
  problems: [
    {
      slug: "maze-runner",
      label: "A",
      rateLimit: { max: 30, windowSeconds: 60 },
    },
  ],

  participants: { mode: "group", group: "demo" },
} satisfies ContestConfigInput;
