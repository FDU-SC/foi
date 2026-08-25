import { z } from "zod";
import type { PublicProblemConfig } from "@/lib/problems/types";

/**
 * What this content's statement components read off a problem's `ui`.
 *
 * The kernel carries `ui` as `unknown` and never looks inside, so the shape is
 * declared next to the components that consume it. A problem file gets its
 * type error from `satisfies ProblemUi`, not from `problemConfigSchema`.
 */
const problemUiSchema = z.object({
  submit: z.enum(["code", "text", "none"]).default("text"),
  languages: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
});

export type ProblemUi = z.input<typeof problemUiSchema>;
export type SubmitKind = z.infer<typeof problemUiSchema>["submit"];

const DEFAULTS = problemUiSchema.parse({});

export function problemUi(config: PublicProblemConfig) {
  const parsed = problemUiSchema.safeParse(config.ui ?? {});
  return parsed.success ? parsed.data : DEFAULTS;
}
