import type { ContestConfigInput } from "@/lib/contests/types";

/**
 * One round, carrying the three things the kernel's gate suites look for: a
 * group it restricts entry to, a `rateLimit` override on its first problem,
 * and a window that has already closed so the standings have something final
 * to draw.
 *
 * It lists only `queued-echo`, which leaves `inline-echo` outside it — and
 * "a problem this round does not contain" is what separates
 * `contest-mismatch` from `not-entered`.
 */
export const contest = {
  slug: "example",
  title: "示例赛",
  description: "骨架 content 的示例比赛。",

  ruleset: { id: "plain" },

  startsAt: "2026-01-01T13:00:00+08:00",
  freezeAt: "2026-01-01T17:00:00+08:00",
  endsAt: "2026-01-01T18:00:00+08:00",

  problems: [
    {
      slug: "queued-echo",
      label: "A",
      rateLimit: { max: 30, windowSeconds: 60 },
    },
  ],

  participants: { mode: "group", group: "参赛者" },
} satisfies ContestConfigInput;
