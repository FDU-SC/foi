import { z } from "zod";
import { SLUG_PATTERN } from "@/lib/utils";

/**
 * What the authoring form submits, and what is wrong with it.
 *
 * Kept apart from `authoring.ts` — which reads and writes the database — so the
 * form can name these types without pulling a server module into the browser
 * bundle.
 */

export const caseSchema = z.object({
  name: z.string().trim().min(1, "测试点需要一个名字").max(80),

  /** Passed to the script positionally, after its name. */
  argv: z.array(z.string().max(200)).max(24).default([]),

  threads: z.coerce.number().int().positive().max(512).optional(),

  /** The whole test point's wall-clock budget, not the statement's time limit. */
  timeLimitMs: z.coerce.number().int().positive().max(3_600_000),

  maxScore: z.coerce.number().min(0).max(10_000),
});

export const contestLinkSchema = z.object({
  slug: z.string().trim().min(1).max(64),

  /** The contest letter, when the round numbers its problems. */
  label: z.string().trim().max(8).optional(),
});

/**
 * `ui` is a record rather than named fields: the keys belong to the deployment,
 * declared in `content/authoring.ts`, and the platform checks them against that
 * declaration instead of knowing them.
 */
export const draftSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1, "请填写标识")
    .max(64)
    .regex(SLUG_PATTERN, "标识只能包含小写字母、数字和连字符"),

  title: z.string().trim().min(1, "请填写标题").max(120),

  maxScore: z.coerce.number().positive("总分必须大于 0").max(10_000),

  statementMdx: z.string().max(200_000).default(""),

  ui: z.record(z.string(), z.unknown()).default({}),

  viewsPreset: z.string().trim().min(1).max(64),

  script: z.string().trim().min(1, "请指定判题脚本").max(200),

  contestant: z.string().trim().min(1, "请指定选手提交覆盖的文件").max(200),

  shell: z.string().trim().max(40).optional(),

  memoryLimitMb: z.coerce.number().int().positive("内存上限必须大于 0").max(1_048_576),

  maxFileMb: z.coerce.number().int().positive("单文件上限必须大于 0").max(1_048_576),

  /**
   * The stack each thread gets, in megabytes.
   *
   * Not independent of `memoryLimitMb`: the judge derives the address space as
   * `memoryLimitMb + threads × stackLimitMb + 16`, per test point. Left out, the
   * judge's own default applies — which is the `ulimit -s` default and the right
   * answer for everything that is not deeply recursive.
   */
  stackLimitMb: z.coerce.number().int().positive().max(1_048_576).optional(),

  /**
   * Whether a run is held to an address-space budget.
   *
   * `bounded` contains an allocation bomb. `unbounded` is for a runtime that
   * reserves a large address space at start-up and touches little of it: held to
   * the budget, that reservation reads exactly like the submission running out
   * of memory. The stack limit still applies either way.
   */
  addressSpace: z.enum(["bounded", "unbounded"]).optional(),

  /**
   * Seeds the per-submission hidden value.
   *
   * Unpredictability per submission comes from the submission's own id; the seed
   * is what makes the values of one problem different from another's, and
   * changing it invalidates every hidden value at once. Left out, the judge's
   * default applies.
   */
  seed: z.coerce.number().int().positive().max(2_147_483_647).optional(),

  /**
   * Whether a run that reported no result line is a disrupted evaluation rather
   * than a score.
   *
   * The form always states this: a checkbox that is unticked and a checkbox that
   * was never there are the same thing in a form submission, so the value is
   * written down rather than left to the judge's default.
   */
  resultRequired: z.boolean().default(true),

  cases: z.array(caseSchema).min(1, "至少需要一个测试点").max(200),

  contests: z.array(contestLinkSchema).max(64).default([]),
});

export type DraftInput = z.output<typeof draftSchema>;

export interface DraftIssues {
  errors: string[];
  warnings: string[];
}

/**
 * The argv of one test point, from the form's single text field.
 *
 * Space-separated is the form's own notation. A JSON array is accepted as well
 * because the natural thing to paste is the `argv: [...]` line out of a
 * repository `problem.ts`, and splitting that on whitespace produces arguments
 * the judge cannot use — quietly, since every fragment is still a string.
 */
export function caseArgv(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every((one) => typeof one === "string")) {
        return parsed;
      }
    } catch {
      // Not JSON after all, so read it as the space-separated form.
    }
  }

  return trimmed.split(/\s+/);
}
