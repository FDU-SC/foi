import { z } from "zod";
import type { PublicProblemConfig } from "@/lib/problems/types";

const problemUiSchema = z.object({
  languages: z.array(z.string()).optional(),
  placeholder: z.string().optional(),

  difficulty: z.string().min(1).optional(),
  tags: z.array(z.string()).default([]),
});

export type ProblemUi = z.input<typeof problemUiSchema>;

const DEFAULTS = problemUiSchema.parse({});

export function problemUi(config: PublicProblemConfig) {
  const parsed = problemUiSchema.safeParse(config.ui ?? {});
  return parsed.success ? parsed.data : DEFAULTS;
}
