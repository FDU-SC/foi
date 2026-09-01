import { z } from "zod";
import { audienceSchema } from "@/lib/authz/audience";
import { actionRateLimitSchema } from "@/lib/problems/types";
import { SLUG_PATTERN } from "@/lib/utils";
import { zonedDateTime } from "@/lib/zoned-date-time";

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

/**
 * What the contest leaves open once `endsAt` has passed.
 *
 * A problem is reachable only through a contest, so this is the whole of a
 * problem's afterlife: a round that seals itself takes its problems with it,
 * and one that keeps collecting is a practice area whose leaderboard still
 * covers the official window alone.
 */
const afterEndSchema = z
  .object({
    statements: z.boolean().default(true),

    submissions: z.boolean().default(false),
  })
  .prefault({});

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

    leaderboards: z.array(leaderboardSchema).min(1, "至少需要一个排行榜"),

    startsAt: zonedDateTime,
    endsAt: zonedDateTime,

    freezeAt: zonedDateTime.optional(),

    afterEnd: afterEndSchema,

    visibleTo: audienceSchema,

    problems: z.array(contestProblemSchema).default([]),
    participants: participantsSchema,
  })
  .superRefine((contest, ctx) => {
    if (contest.afterEnd.submissions && !contest.afterEnd.statements) {
      ctx.addIssue({
        code: "custom",
        path: ["afterEnd", "statements"],
        message:
          "赛后收题却不展示题面是矛盾的：没有人打得开的题目也没有人提交得了。",
      });
    }

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
export type ContestAfterEnd = ContestConfig["afterEnd"];

export type ContestClock = Pick<
  ContestConfig,
  "startsAt" | "endsAt" | "freezeAt"
>;

/**
 * The clock plus what the contest declared about its own afterlife.
 *
 * Not `ContestWindow` — `lib/standings/types.ts` already owns that name for the
 * `startsAt`..`endsAt` pair a ruleset scores, and the two must not be confused:
 * a ruleset is told the window and nothing about `afterEnd`, precisely so that
 * a round staying open changes nothing about how it is scored.
 */
export type ContestSchedule = ContestClock & { afterEnd: ContestAfterEnd };

export type Participants = ContestConfig["participants"];

/**
 * Whether someone falls inside the declared competitor set. This is the roster
 * question only — whether they may actually compete is decided by the
 * `contest.enter` policies that read it.
 */
export function matchesParticipants(
  participants: Participants,
  who: { uid: number | null; groups: readonly string[] },
): boolean {
  switch (participants.mode) {
    case "open":
      return true;
    case "list":
      return who.uid !== null && participants.uids.includes(who.uid);
    case "group":
      return who.groups.includes(participants.group);
  }
}

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

/**
 * Whether the contest is showing its problems: the clock has started them, and
 * it has not sealed them again on its way out.
 */
export function showsStatements(
  contest: ContestSchedule,
  now = new Date(),
): boolean {
  if (!hasContestStarted(contest, now)) return false;
  return !hasContestEnded(contest, now) || contest.afterEnd.statements;
}

/**
 * Whether the contest is taking work: inside its own window, or past it and
 * still open by its own declaration.
 *
 * Late work is practice rather than a second round, because a leaderboard
 * scores `startsAt`..`endsAt` and nothing else. That is the ruleset's doing —
 * it runs its submissions through `submissionsInWindow` — so the guarantee is
 * asserted of every registered ruleset in `lib/standings/window.test.ts`.
 */
export function acceptsSubmissions(
  contest: ContestSchedule,
  now = new Date(),
): boolean {
  if (isContestOpen(contest, now)) return true;
  return hasContestEnded(contest, now) && contest.afterEnd.submissions;
}

export const PHASE_LABEL: Record<ContestPhase, string> = {
  upcoming: "未开始",
  running: "进行中",
  frozen: "封榜中",
  ended: "已结束",
};

/**
 * What to put on the badge.
 *
 * The phase is about the clock alone, so a round that finished and kept its
 * door open needs the extra half sentence: without it "已结束" would sit above
 * a submit panel that still works.
 */
export function contestStatus(
  contest: ContestSchedule,
  now = new Date(),
): { label: string; tone: (typeof PHASE_TONE)[ContestPhase] } {
  const phase = contestPhase(contest, now);
  const collecting = phase === "ended" && contest.afterEnd.submissions;

  return {
    label: collecting ? "已结束 · 仍可提交" : PHASE_LABEL[phase],
    tone: PHASE_TONE[phase],
  };
}

export const PHASE_TONE = {
  upcoming: "info",
  running: "ok",
  frozen: "warn",
  ended: "neutral",
} as const satisfies Record<ContestPhase, string>;
