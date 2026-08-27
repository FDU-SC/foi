import { z } from "zod";
import { audienceSchema } from "@/lib/permissions/audience";
import { actionRateLimitSchema } from "@/lib/problems/types";
import { SLUG_PATTERN } from "@/lib/utils";

const ZONED_ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const zonedDateTime = z
  .string()
  .regex(
    ZONED_ISO,
    "时间必须是带时区的 ISO 8601，例如 2026-01-15T13:00:00+08:00",
  )
  .transform((value) => new Date(value))
  .refine((date) => !Number.isNaN(date.getTime()), "不是有效的时间");

const contestProblemSchema = z.object({
  slug: z.string().min(1),

  label: z.string().min(1).max(8),

  points: z.number().positive().optional(),

  rateLimit: actionRateLimitSchema.optional(),

  config: z.unknown().optional(),
});

const participantsSchema = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("open") }),
    z.object({ mode: z.literal("group"), group: z.string().min(1) }),
    z.object({
      mode: z.literal("list"),
      uids: z.array(z.number().int().positive()).min(1),
    }),
  ])
  .default({ mode: "open" });

const leaderboardSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  ruleset: z.object({
    id: z.string().min(1),
    config: z.unknown().optional(),
  }),
});

export type LeaderboardConfig = z.infer<typeof leaderboardSchema>;

export const contestConfigSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .regex(SLUG_PATTERN, "标识只能包含小写字母、数字和连字符"),
    title: z.string().min(1),
    description: z.string().optional(),

    /** @deprecated Use `leaderboards` instead. Kept as sugar: auto-expands to a single leaderboard. */
    ruleset: z
      .object({
        id: z.string().min(1),
        config: z.unknown().optional(),
      })
      .optional(),

    leaderboards: z.array(leaderboardSchema).optional(),

    startsAt: zonedDateTime,
    endsAt: zonedDateTime,

    freezeAt: zonedDateTime.optional(),

    visibleTo: audienceSchema,

    problems: z.array(contestProblemSchema).default([]),
    participants: participantsSchema,
  })
  .transform((raw) => {
    const leaderboards =
      raw.leaderboards ??
      (raw.ruleset
        ? [{ id: "main", title: "排行榜", ruleset: raw.ruleset }]
        : undefined);

    const { ruleset: _ignored, ...rest } = raw;
    return { ...rest, leaderboards: leaderboards! };
  })
  .refine((c) => c.leaderboards && c.leaderboards.length > 0, {
    path: ["leaderboards"],
    message: "至少需要一个排行榜（或提供 ruleset 语法糖）",
  })
  .superRefine((contest, ctx) => {
    if (contest.endsAt <= contest.startsAt) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "结束时间必须晚于开始时间",
      });
    }

    if (contest.freezeAt) {
      if (
        contest.freezeAt < contest.startsAt ||
        contest.freezeAt > contest.endsAt
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["freezeAt"],
          message: "封榜时间必须落在比赛区间内",
        });
      } else if (contest.freezeAt.getTime() === contest.endsAt.getTime()) {
        ctx.addIssue({
          code: "custom",
          path: ["freezeAt"],
          message:
            "封榜时间不能等于结束时间：那是一个空的封榜窗口，比赛永远不会进入封榜相位。请提前 freezeAt，或去掉它。",
        });
      }
    }

    const lbIds = new Set<string>();
    for (const [index, lb] of contest.leaderboards.entries()) {
      if (lbIds.has(lb.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["leaderboards", index, "id"],
          message: `排行榜 "${lb.id}" 重复`,
        });
      }
      lbIds.add(lb.id);
    }

    const slugs = new Set<string>();
    const labels = new Set<string>();
    contest.problems.forEach((problem, index) => {
      if (slugs.has(problem.slug)) {
        ctx.addIssue({
          code: "custom",
          path: ["problems", index, "slug"],
          message: `题目 "${problem.slug}" 重复`,
        });
      }
      if (labels.has(problem.label)) {
        ctx.addIssue({
          code: "custom",
          path: ["problems", index, "label"],
          message: `编号 "${problem.label}" 重复`,
        });
      }
      slugs.add(problem.slug);
      labels.add(problem.label);
    });
  });

export type ContestConfig = z.infer<typeof contestConfigSchema>;
export type ContestConfigInput = z.input<typeof contestConfigSchema>;
export type ContestProblemConfig = z.infer<typeof contestProblemSchema>;

export type ContestClock = Pick<
  ContestConfig,
  "startsAt" | "endsAt" | "freezeAt"
>;

export type ContestPhase = "upcoming" | "running" | "frozen" | "ended";

export function contestPhase(
  contest: ContestClock,
  now = new Date(),
): ContestPhase {
  if (now < contest.startsAt) return "upcoming";
  if (now > contest.endsAt) return "ended";
  if (contest.freezeAt && now >= contest.freezeAt) return "frozen";
  return "running";
}

const OPEN_PHASES: ContestPhase[] = ["running", "frozen"];
const STARTED_PHASES: ContestPhase[] = ["running", "frozen", "ended"];
const ENDED_PHASES: ContestPhase[] = ["ended"];

export function isContestOpen(
  contest: ContestClock,
  now = new Date(),
): boolean {
  return OPEN_PHASES.includes(contestPhase(contest, now));
}

export function hasContestStarted(
  contest: ContestClock,
  now = new Date(),
): boolean {
  return STARTED_PHASES.includes(contestPhase(contest, now));
}

export function hasContestEnded(
  contest: ContestClock,
  now = new Date(),
): boolean {
  return ENDED_PHASES.includes(contestPhase(contest, now));
}

export const PHASE_LABEL: Record<ContestPhase, string> = {
  upcoming: "未开始",
  running: "进行中",
  frozen: "封榜中",
  ended: "已结束",
};

export const PHASE_TONE = {
  upcoming: "info",
  running: "ok",
  frozen: "warn",
  ended: "neutral",
} as const satisfies Record<ContestPhase, string>;
