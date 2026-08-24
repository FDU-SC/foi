import type { Viewer } from "@/lib/auth/viewer";
import { accountsFor } from "@/lib/accounts/access";
import { declaredGroupIds } from "@/lib/auth/groups";
import { allContests } from "@/lib/contests/registry";
import type { ContestConfig } from "@/lib/contests/types";
import { resolveParticipants } from "@/lib/contests/queries";
import {
  enrollmentPolicy,
  groupsFor,
  knownGroups,
  listGrants,
  listRules,
} from "@/lib/enrollment/registry";
import type { EnrollmentPolicy, EnrollmentRule, Grant } from "@/lib/enrollment/types";
import { loadAdminOverview, type AdminOverview } from "./drift";

/**
 * How the operations console obtains anything.
 *
 * The other five access layers exist because of a rule this codebase keeps
 * relearning — see `lib/problems/access.ts` on gating at the point of retrieval
 * rather than at each call site, and `lib/submissions/access.ts` on what
 * happens when the same rule is written out three times and missed the fourth.
 * The console was the one part with no such layer, so `admin.access` was a
 * thing each page had to remember, and two of the four did: `/admin` and
 * `/admin/contests` checked it, `/admin/accounts` and `/admin/enrollment` did
 * not. The second of those was the one that mattered, because its data was not
 * gated by anything else — a suspended administrator holding a live JWT gets
 * past `proxy.ts`, which reads the token and never the accounts table, and
 * would have been handed the registration policy, every cohort regex, and the
 * grants list naming everybody who holds privilege.
 *
 * So there is no way to ask this module for console data without saying who is
 * asking, and the answer for somebody who may not have it is nothing at all.
 */

/** Nothing rather than an exception, matching the other access layers. */
export async function adminOverviewFor(
  viewer: Viewer,
): Promise<AdminOverview | null> {
  if (!viewer.can("admin.access")) return null;
  return loadAdminOverview();
}

export interface AdminContestRow {
  config: ContestConfig;
  /** Resolved entrants, or null for a contest whose entry is open. */
  entrants: number | null;
}

/**
 * Every contest, with its entry list resolved.
 *
 * Deliberately the raw registry rather than `contestsFor`: the console's job is
 * to show what the repository says, including the rounds staged for nobody.
 * That is what `admin.access` buys, and why this cannot be reached without it.
 */
export async function adminContestsFor(
  viewer: Viewer,
): Promise<AdminContestRow[] | null> {
  if (!viewer.can("admin.access")) return null;

  return Promise.all(
    allContests().map(async (config) => ({
      config,
      entrants: (await resolveParticipants(config))?.length ?? null,
    })),
  );
}

export interface EnrollmentView {
  policy: EnrollmentPolicy;
  rules: EnrollmentRule[];
  grants: Grant[];
  /** Every group the repository can be shown to produce. */
  known: ReturnType<typeof knownGroups>;
  /**
   * Active accounts each rule matches, positionally aligned with `rules`.
   *
   * Null when the viewer may read the directory but not the addresses in it.
   * The count is the whole point of the page — a rule that has fallen behind
   * the current intake's address format looks fine in a diff and matches
   * nobody — but it is computed from personal data, so it answers to
   * `account.read` while the rules themselves answer to `admin.access`.
   */
  ruleMatches: number[] | null;
  groupCounts: Map<string, number> | null;
  /** Accounts with an address that no rule recognises. */
  untagged: number | null;
}

export async function enrollmentViewFor(
  viewer: Viewer,
): Promise<EnrollmentView | null> {
  if (!viewer.can("admin.access")) return null;

  const rules = listRules();
  const base = {
    policy: enrollmentPolicy,
    rules,
    grants: listGrants(),
    known: knownGroups(),
  };

  // `accountsFor` is the gate on the addresses; an empty answer here means the
  // viewer holds `admin.access` without `account.read`, which is a legitimate
  // split and has to render as "no counts" rather than as "zero accounts".
  if (!viewer.can("account.read")) {
    return { ...base, ruleMatches: null, groupCounts: null, untagged: null };
  }

  const active = await accountsFor(viewer, { status: "active" });

  // Declared groups start at zero so they are listed even when empty. That is
  // the value of the card right after somebody adds a group: a count of 0 next
  // to a name you just wrote is how a mistyped grant announces itself, and
  // absence from the list would not.
  const groupCounts = new Map<string, number>(
    declaredGroupIds().map((id) => [id, 0]),
  );
  let untagged = 0;
  for (const row of active) {
    const resolved = groupsFor(row.handle, row.email);
    if (resolved.length === 0 && row.email) untagged += 1;
    for (const id of resolved) {
      groupCounts.set(id, (groupCounts.get(id) ?? 0) + 1);
    }
  }

  return {
    ...base,
    ruleMatches: rules.map(
      (rule) =>
        active.filter((row) => row.email && rule.match.test(row.email)).length,
    ),
    groupCounts,
    untagged,
  };
}
