import type { SQL } from "drizzle-orm";
import { z } from "zod";
import type { ContestConfig } from "@/lib/contests/types";
import {
  ACTION_IDS,
  isActionId,
  type ActionId,
  type DenialReason,
  type ResourceOf,
} from "./actions";
import type { Viewer } from "./viewer";

export type Effect = "permit" | "forbid";

/**
 * Who a policy applies to. Declarative on purpose: because a matcher is data
 * and not a function, the group ids a policy hands power to can be read off it
 * without running anything. That is what `privilegedGroups()` relies on, and
 * what lets the admin console render a policy matrix.
 *
 * Omitting it means "anyone, including anonymous".
 */
export type PrincipalMatcher =
  | { group: string }
  | { anyGroup: readonly string[] }
  | { authenticated: true }
  /** The viewer owns the resource, per `OWNER_OF`. */
  | { self: true };

export interface EvalInputFor<A extends ActionId> {
  viewer: Viewer;
  action: A;
  resource: ResourceOf<A>;
  now: Date;

  /** The contest the caller claims this action belongs to, if any. */
  contest: ContestConfig | null;

  /** Which interactive action on a problem is being invoked. */
  invocation: string | null;
}

/** Distributes, so a policy over several actions narrows on `action`. */
export type EvalInput<A extends ActionId> = A extends ActionId
  ? EvalInputFor<A>
  : never;

/** A row filter answers about a whole table, so it never sees one resource. */
export interface FilterInput {
  viewer: Viewer;
  now: Date;
}

export type ActionSelector = ActionId | readonly ActionId[] | "*";

type Selected<A extends ActionSelector> = A extends "*"
  ? ActionId
  : A extends readonly (infer U extends ActionId)[]
    ? U
    : A extends ActionId
      ? A
      : never;

export interface PolicyDeclaration<A extends ActionSelector> {
  /** Unique across builtin and content; appears in `Decision.via`. */
  id: string;

  effect: Effect;

  /** One sentence in Chinese, shown wherever the policy set is listed. */
  describe: string;

  action: A;

  principal?: PrincipalMatcher;

  /** Extra condition. Omitting it means the scope alone decides. */
  when?: (input: EvalInput<Selected<A>>) => boolean;

  /**
   * For queryable actions: the same question as `when`, phrased as SQL over
   * the resource's table. Required whenever `when` is present, because list
   * endpoints ask the database instead of every row.
   */
  filter?: (input: FilterInput) => SQL | undefined;

  /** Forbid only: what to tell the user. Defaults to the action's denial. */
  reason?: DenialReason;
}

/** Type-erased form the engine evaluates. Build one with `policy()`. */
export interface CompiledPolicy {
  id: string;
  effect: Effect;
  describe: string;
  actions: readonly ActionId[];

  /** Declared as `"*"`, so it stays complete as the catalog grows. */
  wildcard: boolean;

  principal?: PrincipalMatcher;
  when?: (input: EvalInputFor<ActionId>) => boolean;
  filter?: (input: FilterInput) => SQL | undefined;
  reason?: DenialReason;
}

export function policy<const A extends ActionSelector>(
  declaration: PolicyDeclaration<A>,
): CompiledPolicy {
  const { action, when, ...rest } = declaration;

  const wildcard = action === "*";
  const actions = wildcard
    ? [...ACTION_IDS]
    : typeof action === "string"
      ? [action as ActionId]
      : [...(action as readonly ActionId[])];

  return {
    ...rest,
    actions,
    wildcard,
    when: when as CompiledPolicy["when"],
  };
}

export type Decision =
  | { allow: true; via: string }
  | { allow: false; via: string | null; reason: DenialReason };

const principalSchema = z.union([
  z.strictObject({ group: z.string().min(1) }),
  z.strictObject({ anyGroup: z.array(z.string().min(1)).min(1) }),
  z.strictObject({ authenticated: z.literal(true) }),
  z.strictObject({ self: z.literal(true) }),
]);

const reasonSchema = z.strictObject({
  code: z.string().min(1).max(64),
  message: z.string().min(1).max(200),
  detail: z.record(z.string(), z.unknown()).optional(),
});

const predicate = z.custom<(input: never) => boolean>(
  (value) => typeof value === "function",
  { message: "必须是一个函数" },
);

export const compiledPolicySchema = z
  .strictObject({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9:._-]*$/, "策略 id 只能包含小写字母、数字和 :._-"),
    effect: z.enum(["permit", "forbid"]),
    describe: z.string().min(1).max(200),
    actions: z
      .array(z.string().refine(isActionId, "不是 lib/authz/actions.ts 里的动作"))
      .min(1),
    wildcard: z.boolean(),
    principal: principalSchema.optional(),
    when: predicate.optional(),
    filter: predicate.optional(),
    reason: reasonSchema.optional(),
  })
  .superRefine((declared, ctx) => {
    if (declared.effect === "permit" && declared.reason) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "放行的策略不需要 reason，它只在 forbid 上有意义",
      });
    }
  });
