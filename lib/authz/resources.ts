import type {
  ContestConfig,
  ContestProblemConfig,
} from "@/lib/contests/types";
import type { AccountStatus } from "@/lib/db/schema";
import type { ProblemConfig } from "@/lib/problems/types";

/**
 * The things authorization is asked about.
 *
 * Every import here is type-only on purpose: the catalog must not pull the
 * domain registries into the policy engine's module graph.
 */

/**
 * A problem as it is reachable: inside a contest, never on its own.
 *
 * Attribution is structural rather than claimed. There is no way to ask
 * whether someone may open or submit to a problem without naming the contest
 * it is being worked on as part of, so there is nothing to cross-check.
 */
export interface ContestProblemRef {
  contest: ContestConfig;

  /** The contest's own entry for it: label, points, rate limit, config. */
  entry: ContestProblemConfig;

  problem: ProblemConfig;
}

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
  contestSlug: string;
}

export interface BackendRef {
  id: string;
}

export interface ResourceMap {
  problem: ContestProblemRef;
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
