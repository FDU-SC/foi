import type { ContestConfig } from "@/lib/contests/types";
import type { AccountStatus } from "@/lib/db/schema";
import type { ProblemConfig } from "@/lib/problems/types";

/**
 * The things authorization is asked about.
 *
 * Every import here is type-only on purpose: the catalog must not pull the
 * domain registries into the policy engine's module graph.
 */

/** Enough of an account for policies to reason about it as a target. */
export interface AccountRef {
  uid: number;
  status: AccountStatus;
  email: string | null;
  emailVerified: boolean;
  groups: readonly string[];
}

export interface SubmissionRef {
  id: string;
  uid: number;
  problemSlug: string;
  contestSlug: string | null;
}

export interface BackendRef {
  id: string;
}

export interface ResourceMap {
  problem: ProblemConfig;
  contest: ContestConfig;
  submission: SubmissionRef;
  account: AccountRef;
  backend: BackendRef;

  /** Actions with no target — entering the admin console, registering. */
  site: null;
}

export type ResourceKind = keyof ResourceMap;

/**
 * Who a resource belongs to, for the `{ self: true }` principal matcher.
 * Resources absent from this table have no owner, so `self` never matches them.
 */
export const OWNER_OF: {
  [K in ResourceKind]?: (resource: ResourceMap[K]) => number;
} = {
  submission: (submission) => submission.uid,
  account: (account) => account.uid,
};
