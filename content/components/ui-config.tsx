import { z } from "zod";
import type { PublicProblemConfig } from "@/lib/problems/types";

/**
 * What this deployment's statement components read off a problem's `ui`.
 *
 * The kernel carries `ui` as `unknown` and never looks inside — the same
 * bargain `backend.config` gets. So the shape is declared here, next to the
 * components that consume it, and a problem file gets its type error from
 * `satisfies ProblemUi` rather than from `problemConfigSchema`.
 *
 * Parsed rather than cast because a problem may omit it entirely, and because
 * this runs in the browser against data that came through a JSON boundary.
 * Failure is not fatal: a malformed `ui` falls back to the defaults, since a
 * statement that renders with the wrong placeholder is better than one that
 * renders a crash.
 */
const problemUiSchema = z.object({
  /**
   * Which submitter to draw. `none` means the statement renders its own on
   * `useSubmit()`.
   */
  submit: z.enum(["code", "flag", "text", "none"]).default("code"),
  /** Offered in the language picker, in order. Only read when `submit` is `code`. */
  languages: z.array(z.string()).optional(),
  placeholder: z.string().optional(),

  /**
   * How this deployment sorts its problems, drawn by `ProblemBadges`. Here
   * rather than on `problemConfigSchema` because nothing but those badges ever
   * reads them: a platform declaring that every problem has a `difficulty` has
   * already decided something for a deployment that grades on two axes, or on
   * none. `maxScore` stays on the problem because scoring genuinely reads it.
   */
  difficulty: z.string().min(1).optional(),
  tags: z.array(z.string()).default([]),
});

export type ProblemUi = z.input<typeof problemUiSchema>;
export type SubmitKind = z.infer<typeof problemUiSchema>["submit"];

const DEFAULTS = problemUiSchema.parse({});

export function problemUi(config: PublicProblemConfig) {
  const parsed = problemUiSchema.safeParse(config.ui ?? {});
  return parsed.success ? parsed.data : DEFAULTS;
}
