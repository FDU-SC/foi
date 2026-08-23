import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * The worked example for a contest, and the one `scripts/demo-data.sql`
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

  problems: [{ slug: "maze-runner", label: "A" }],

  participants: { mode: "tag", tag: "demo" },
} satisfies ContestConfigInput;
