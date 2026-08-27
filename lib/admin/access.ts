import type { Viewer } from "@/lib/permissions/viewer";
import {
  accountDirectoryFor,
  accountsFor,
  type AccountDirectory,
} from "@/lib/accounts/access";
import { normalizeHandle } from "@/lib/accounts/types";
import { allContests } from "@/lib/contests/registry";
import { resolveParticipants } from "@/lib/contests/resolve";
import type { ContestConfig } from "@/lib/contests/types";
import {
  enrollmentPolicy,
  knownGroups,
  listRules,
  tallyCohorts,
} from "@/lib/enrollment/registry";
import {
  isHandlesRule,
  type EnrollmentPolicy,
  type EnrollmentRule,
} from "@/lib/enrollment/types";
import { loadAdminOverview, type AdminOverview } from "./drift";

/**
 * How the operations console obtains anything.
 *
 * Gated at the point of retrieval, like the other five access layers — see
 * `lib/problems/access.ts`. Left to each page to remember, `admin.access` is a
 * check somebody misses, and `/admin/enrollment` is the page where that costs
 * most: its data is gated by nothing else, and a suspended administrator
 * holding a live JWT gets past `proxy.ts`, which reads the token and never the
 * accounts table, to the registration policy, every cohort regex, and the
 * rules naming everybody who holds privilege.
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

/**
 * The console's account page, or nothing at all.
 *
 * Two capabilities, nested rather than combined, and keeping them apart is the
 * whole reason this wrapper exists rather than the page calling
 * `accountDirectoryFor` straight. `admin.access` decides whether there is a
 * page — null, and it 404s like the other three. `account.read` decides
 * whether the directory inside it has anybody in it, and that answer stays
 * `accountDirectoryFor`'s to give: an operator entitled to the console but not
 * to personal data gets the page with an empty table, which is the same split
 * `enrollmentViewFor` makes for its hit counts.
 *
 * Folding the two into one check would have to pick a side, and both sides are
 * wrong: gate the addresses on `admin.access` and the one page here that shows
 * personal data stops answering to the capability that names it; gate the page
 * on `account.read` and somebody entitled to the console gets a 404.
 */
export async function adminAccountsFor(
  viewer: Viewer,
): Promise<AccountDirectory | null> {
  if (!viewer.can("admin.access")) return null;
  return accountDirectoryFor(viewer);
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
   *
   * A `handles` rule counts the named accounts that actually exist, which is
   * the same question in the other shape: a rule naming a handle nobody has
   * registered reads as 0, and that is how a typo in a privilege grant
   * announces itself.
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
    known: knownGroups(),
  };

  // `accountsFor` is the gate on the addresses; an empty answer here means the
  // viewer holds `admin.access` without `account.read`, which is a legitimate
  // split and has to render as "no counts" rather than as "zero accounts".
  if (!viewer.can("account.read")) {
    return { ...base, ruleMatches: null, groupCounts: null, untagged: null };
  }

  const active = await accountsFor(viewer, { status: "active" });

  // One pass for both readings, and the same one `lib/admin/drift.ts` runs to
  // list the untagged handles this page only counts.
  const { counts: groupCounts, untagged } = tallyCohorts(active);

  const activeHandles = new Set(active.map((row) => row.handle));

  return {
    ...base,
    ruleMatches: rules.map((rule) =>
      isHandlesRule(rule)
        ? rule.handles.filter((handle) =>
            activeHandles.has(normalizeHandle(handle)),
          ).length
        : active.filter((row) => row.email && rule.email.test(row.email)).length,
    ),
    groupCounts,
    untagged: untagged.length,
  };
}
