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

export type ContestPhase = "upcoming" | "running" | "ended";

export function contestPhase(
  contest: Pick<ContestConfig, "startsAt" | "endsAt">,
  now = new Date(),
): ContestPhase {
  if (now < contest.startsAt) return "upcoming";
  if (now > contest.endsAt) return "ended";
  return "running";
}

export const PHASE_LABEL: Record<ContestPhase, string> = {
  upcoming: "未开始",
  running: "进行中",
  ended: "已结束",
};
