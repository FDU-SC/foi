import { z } from "zod";
import { audienceSchema } from "@/lib/auth/audience";
import { actionRateLimitSchema } from "@/lib/problems/types";

/**
 * Contests carry absolute instants, so a bare `2026-01-15T13:00` would mean
 * different things depending on where the server runs. Requiring the offset
 * makes the intended wall-clock time reviewable in the diff.
 */
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
  /** Shown instead of the slug during the contest, conventionally "A", "B"… */
  label: z.string().min(1).max(8),
  /** Overrides the problem's own maxScore for this contest only. */
  points: z.number().positive().optional(),
  /**
   * Overrides the problem's own submit throttle for this contest only.
   *
   * The same relationship `points` has with `maxScore`, and here for the same
   * reason: how often a competitor may submit is a property of the round, not
   * of the problem. A five-hour ACM round and a two-week practice set want
   * different answers out of the same problem, and neither should have to edit
   * it. Omitted falls back to the problem's own, then to the kernel default —
   * see `submitRateLimit` in `lib/problems/types.ts`.
   */
  rateLimit: actionRateLimitSchema.optional(),
  /** Per-contest data handed to the ruleset. Opaque to the kernel. */
  config: z.unknown().optional(),
});

/**
 * Who appears on the standings.
 *
 * `open` reproduces the historical behaviour of deriving the roster from
 * whoever submitted, which keeps casual contests usable with no setup.
 * `group` is the one to reach for otherwise: the cohort is described once in
 * roster and referenced here.
 */
const participantsSchema = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("open") }),
    z.object({ mode: z.literal("group"), group: z.string().min(1) }),
    z.object({
      mode: z.literal("list"),
      handles: z.array(z.string().min(1)).min(1),
    }),
  ])
  .default({ mode: "open" });

export const contestConfigSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/, "标识只能包含小写字母、数字和连字符"),
    title: z.string().min(1),
    description: z.string().optional(),

    /**
     * How this contest is scored.
     *
     * `id` names one of the shared templates in `content/rulesets/`. Omit it
     * and the contest's own `ruleset.tsx` is used instead — see the note in
     * `content/ruleset-modules.ts` on when each is the right choice. Naming both, or
     * neither, is an error `lib/contests/registry.ts` refuses at load.
     */
    ruleset: z.object({
      id: z.string().min(1).optional(),
      config: z.unknown().optional(),
    }),

    startsAt: zonedDateTime,
    endsAt: zonedDateTime,
    /** Standings stop updating from this point until the contest ends. */
    freezeAt: zonedDateTime.optional(),

    /**
     * Which groups may see this contest. Omitted means everyone, `[]` means
     * nobody — a round staged in the repository before it is announced.
     *
     * Distinct from `participants`, which decides who is scored. A public
     * round with a closed entry list is an ordinary thing to want, and so is
     * the reverse.
     */
    visibleTo: audienceSchema,

    problems: z.array(contestProblemSchema).default([]),
    participants: participantsSchema,
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
        // Refused for the same reason a `freezeAt` against a format that
        // ignores it is refused in `lib/contests/registry.ts`: the schedule
        // says the board stops updating, and it never does. Freezing at the
        // final instant is an empty window — the contest goes from running
        // straight to ended and the `frozen` phase is unreachable.
        ctx.addIssue({
          code: "custom",
          path: ["freezeAt"],
          message:
            "封榜时间不能等于结束时间：那是一个空的封榜窗口，比赛永远不会进入封榜相位。请提前 freezeAt，或去掉它。",
        });
      }
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

/**
 * Everything the clock needs to place a contest. Named rather than spelled as
 * a `Pick` at each site because two modules take it, and a signature that
 * silently forgets `freezeAt` is one that silently forgets the freeze.
 */
export type ContestClock = Pick<
  ContestConfig,
  "startsAt" | "endsAt" | "freezeAt"
>;

/**
 * Where a contest is on its own clock, and nothing else.
 *
 * `frozen` is a fact about the time of day: the round has reached its
 * `freezeAt` and has not ended. It is *not* the question the standings page
 * asks. Whether the board somebody is looking at is frozen depends on who they
 * are — `standings.viewFrozen` reads through it — and that answer lives on
 * `Standings.frozen`. A UI that reaches for `phase === "frozen"` to answer the
 * second question will tell a holder of the capability that the real ranking
 * they are reading is withheld.
 *
 * `ContestStandings.freezeBypassed` is the two questions multiplied together —
 * the clock says frozen *and* this viewer read through it — so it is a correct
 * caller of this function and the only one in the standings path.
 *
 * The window is `[freezeAt, endsAt]`: `endsAt` is inclusive here for the same
 * reason it is inclusive of `running`, so the sequence a contest walks is
 * always upcoming → running → frozen → ended and never goes backwards. This is
 * the kernel's definition of the window and rulesets follow it; `freezeAt` is
 * refused outside `[startsAt, endsAt)` above, which is what makes the two
 * agree without either having to read the other.
 */
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

/**
 * The mechanical safeguard the predicates below are built on.
 *
 * Adding `frozen` to the union broke nothing that the compiler could see,
 * because every caller compared the phase to a string literal — `!== "running"`
 * kept typechecking and quietly closed submissions for the last hour of every
 * frozen round. Routing each question through an exhaustive switch is what
 * turns the next added phase into a build failure instead of an outage.
 */
function assertNever(phase: never): never {
  throw new Error(`未处理的比赛相位: ${String(phase)}`);
}

/**
 * Whether anything may still be sent to this round.
 *
 * A freeze stops the board from updating; it does not stop the contest. The
 * last hour of an ICPC round is its most active one.
 */
export function isContestOpen(
  contest: ContestClock,
  now = new Date(),
): boolean {
  const phase = contestPhase(contest, now);
  switch (phase) {
    case "running":
    case "frozen":
      return true;
    case "upcoming":
    case "ended":
      return false;
    default:
      return assertNever(phase);
  }
}

/**
 * Whether the round has opened, which is what releases its problems.
 *
 * The embargo asks exactly this and nothing about the freeze: a round that has
 * started has published its statements, and freezing the scoreboard four hours
 * later does not take them back.
 */
export function hasContestStarted(
  contest: ContestClock,
  now = new Date(),
): boolean {
  const phase = contestPhase(contest, now);
  switch (phase) {
    case "running":
    case "frozen":
    case "ended":
      return true;
    case "upcoming":
      return false;
    default:
      return assertNever(phase);
  }
}

/** Whether the round is over. */
export function hasContestEnded(
  contest: ContestClock,
  now = new Date(),
): boolean {
  const phase = contestPhase(contest, now);
  switch (phase) {
    case "ended":
      return true;
    case "upcoming":
    case "running":
    case "frozen":
      return false;
    default:
      return assertNever(phase);
  }
}

export const PHASE_LABEL: Record<ContestPhase, string> = {
  upcoming: "未开始",
  running: "进行中",
  frozen: "封榜中",
  ended: "已结束",
};

/**
 * One tone per phase, so the three pages that draw a phase badge cannot
 * disagree about what 封榜中 looks like.
 *
 * Spelled as literals that happen to be `BadgeTone` rather than typed as one:
 * `lib/` does not import from `components/`, and a wrong tone still fails to
 * compile at the `<Badge>` that uses it.
 */
export const PHASE_TONE = {
  upcoming: "info",
  running: "ok",
  frozen: "warn",
  ended: "neutral",
} as const satisfies Record<ContestPhase, string>;
