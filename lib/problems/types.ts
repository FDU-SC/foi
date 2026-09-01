import { z } from "zod";
import { SLUG_PATTERN } from "@/lib/utils";

import type { BackendUser } from "@/lib/backend/types";

export const actionRateLimitSchema = z.object({
  max: z.number().int().positive(),
  windowSeconds: z.number().int().positive(),
});

export type ActionRateLimit = z.infer<typeof actionRateLimitSchema>;

export const DEFAULT_ACTION_RATE_LIMIT: ActionRateLimit = {
  max: 10,
  windowSeconds: 60,
};

export const DEFAULT_SUBMIT_RATE_LIMIT: ActionRateLimit = {
  max: 20,
  windowSeconds: 60,
};

export interface InlineUnavailable {
  unavailable: true;
  reason: string;
}

export interface InlineResult {
  result: Record<string, unknown>;
  detail?: unknown;
}

export type InlineJudgement = InlineResult | InlineUnavailable;

export function isInlineUnavailable(
  judgement: InlineJudgement,
): judgement is InlineUnavailable {
  return "unavailable" in judgement;
}

export type InlineJudge = (input: {
  payload: unknown;
  config: unknown;
  user: BackendUser;
  contestSlug: string | null;
}) => InlineJudgement;

const inlineBackendSchema = z.strictObject({
  kind: z.literal("inline"),
  config: z.unknown().optional(),

  judge: z.custom<InlineJudge>(
    (value) =>
      typeof value === "function" && value.constructor.name !== "AsyncFunction",
    { message: "内联判题的 judge 必须是一个同步函数" },
  ),
});

const externalBackendSchema = z.strictObject({
  id: z.string().min(1),
  config: z.unknown().optional(),
  actions: z
    .record(
      z.string().regex(/^[a-z0-9-]+$/, "action 名只能包含小写字母、数字和连字符"),
      z.object({ rateLimit: actionRateLimitSchema.optional() }).default({}),
    )
    .default({}),
});

export type InlineBackend = z.infer<typeof inlineBackendSchema>;
export type ExternalBackend = z.infer<typeof externalBackendSchema>;

export function isInlineBackend(
  backend: InlineBackend | ExternalBackend,
): backend is InlineBackend {
  return "kind" in backend && backend.kind === "inline";
}

export const problemConfigSchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(SLUG_PATTERN, "slug 只能包含小写字母、数字和连字符"),
  title: z.string().min(1),
  maxScore: z.number().positive().default(100),

  backend: z.union([inlineBackendSchema, externalBackendSchema]),

  submit: z
    .object({

      rateLimit: actionRateLimitSchema.optional(),
    })
    .default({}),

  ui: z.unknown().optional(),
});

export type ProblemConfig = z.infer<typeof problemConfigSchema>;
export type ProblemConfigInput = z.input<typeof problemConfigSchema>;

export type ExternallyJudged = ProblemConfig & { backend: ExternalBackend };

export function submitRateLimit(
  problem: ProblemConfig,
  override?: ActionRateLimit,
): ActionRateLimit {
  return override ?? problem.submit.rateLimit ?? DEFAULT_SUBMIT_RATE_LIMIT;
}

export type PublicProblemConfig = Omit<ProblemConfig, "backend">;

export function toPublicConfig(config: ProblemConfig): PublicProblemConfig {
  const { backend: _backend, ...rest } = config;
  return rest;
}

