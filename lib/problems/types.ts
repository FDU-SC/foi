import { z } from "zod";
import { audienceSchema } from "@/lib/auth/audience";

/** Display names for the languages the built-in code submitter offers. */
export const LANGUAGES: Record<string, string> = {
  c: "C",
  cpp: "C++",
  python: "Python",
  java: "Java",
  rust: "Rust",
  go: "Go",
  javascript: "JavaScript",
};

export const DIFFICULTIES = ["入门", "普及", "提高", "省选", "NOI"] as const;

/**
 * How often one person may invoke one action.
 *
 * Per action rather than per problem or per backend, because the costs are not
 * comparable: starting a container is expensive and asking whether it is ready
 * is not, and a shared window means the polling drains the budget the spawn
 * needed. Left off, `DEFAULT_ACTION_RATE_LIMIT` applies.
 */
const actionRateLimitSchema = z.object({
  max: z.number().int().positive(),
  windowSeconds: z.number().int().positive(),
});

export type ActionRateLimit = z.infer<typeof actionRateLimitSchema>;

/** Applied to any action that does not name its own. */
export const DEFAULT_ACTION_RATE_LIMIT: ActionRateLimit = {
  max: 10,
  windowSeconds: 60,
};

/**
 * Everything FOI needs to know about a problem. Authored as a TypeScript
 * module in `content/problems/<slug>/problem.ts` so mistakes surface as type
 * errors, and validated at load time so they also surface as clear runtime
 * errors when the shape drifts.
 */
export const problemConfigSchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "slug 只能包含小写字母、数字和连字符"),
  title: z.string().min(1),
  maxScore: z.number().positive().default(100),

  /**
   * Which backend serves this problem and what to hand it. `config` is passed
   * through verbatim; the kernel never looks inside.
   *
   * `actions` opens interactive endpoints on that backend to players who can
   * already see the problem. Each key is forwarded as `POST /action/<key>` and
   * is never interpreted here — spawning a container and asking whether it is
   * ready are the same thing to the kernel, a declared string it may relay.
   *
   * Declared per problem rather than per backend because it is the problem
   * that decides what its statement offers, and an undeclared key is a 404
   * rather than a forwarded request: without the list, `[...path]` would relay
   * anything, including `/judge` and `/status`.
   */
  backend: z.object({
    id: z.string().min(1),
    config: z.unknown().optional(),
    actions: z
      .record(
        z.string().regex(/^[a-z0-9-]+$/, "action 名只能包含小写字母、数字和连字符"),
        z.object({ rateLimit: actionRateLimitSchema.optional() }).default({}),
      )
      .default({}),
  }),

  /** Drives the default `<SubmitPanel />`. Statements may ignore it entirely. */
  submit: z
    .object({
      kind: z.enum(["code", "flag", "text", "none"]).default("code"),
      languages: z.array(z.string()).optional(),
      placeholder: z.string().optional(),
    })
    .default({ kind: "code" }),

  tags: z.array(z.string()).default([]),
  difficulty: z.enum(DIFFICULTIES).optional(),
  /**
   * Which groups may see this problem. Omitted means everyone, `[]` means
   * nobody — that is how a problem is staged before it has an audience.
   *
   * Composes with the contest gate rather than replacing it: a problem for the
   * school team that belongs to next week's round is visible to neither until
   * both say yes.
   */
  visibleTo: audienceSchema,

  /**
   * Whether this problem has been taken out of service.
   *
   * Deliberately *not* a second way to spell `visibleTo: []`. It answers a
   * different question — not "who may read this" but "may anything new be sent
   * to it" — and the two axes cross:
   *
   *   live, with an audience      an ordinary problem
   *   live, `visibleTo: []`       next week's round, not released yet
   *   retired, with an audience   an old problem: read it, but do not submit
   *   retired, `visibleTo: []`    withdrawn along with its statement
   *
   * The third row is the point. Someone who competed on a problem should still
   * be able to open it afterwards, and the contest it belonged to should still
   * render its standings — hiding the problem takes both of those away.
   * DOMjudge's `allow_submit` conflates the two ("disabling this also makes the
   * problem invisible to teams and public") and HydroOJ has a changelog entry
   * for the bug that follows: after a contest ends, a hidden problem made its
   * submissions unreadable.
   *
   * The directory stays in the repository. That is what stops the slug from
   * being reused — the filesystem refuses a second directory by the same name,
   * so no check has to be written and none can be forgotten. Deleting it for
   * real is still possible and still meaningful, and the `restrict` foreign key
   * on `submissions.problem_slug` will make you deal with the history first.
   */
  retired: z.boolean().default(false),

  order: z.number().default(0),
});

export type ProblemConfig = z.infer<typeof problemConfigSchema>;
export type ProblemConfigInput = z.input<typeof problemConfigSchema>;

/**
 * What is safe to hand to the browser. `backend` is stripped because its
 * config routinely holds testdata locations, checker settings, or literal
 * answers.
 */
export type PublicProblemConfig = Omit<ProblemConfig, "backend">;

export function toPublicConfig(config: ProblemConfig): PublicProblemConfig {
  const { backend: _backend, ...rest } = config;
  return rest;
}

/** Config plus whatever the registry derived about the problem. */
export interface ProblemEntry {
  config: ProblemConfig;
  /** Path key from `import.meta.glob`, useful for diagnostics. */
  sourcePath: string;
}
