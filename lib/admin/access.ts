import type { Viewer } from "@/lib/permissions/viewer";
import {
  accountDirectoryFor,
  type AccountDirectory,
} from "@/lib/accounts/access";
import { listAccounts } from "@/lib/accounts/queries";
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
  isUidsRule,
  type EnrollmentPolicy,
  type EnrollmentRule,
} from "@/lib/enrollment/types";
import { loadAdminOverview, type AdminOverview } from "./drift";

export async function adminOverviewFor(
  viewer: Viewer,
): Promise<AdminOverview | null> {
  if (!viewer.can("admin.access")) return null;
  return loadAdminOverview();
}

export async function adminAccountsFor(
  viewer: Viewer,
): Promise<AccountDirectory | null> {
  if (!viewer.can("admin.access")) return null;
  return accountDirectoryFor(viewer);
}

export interface AdminContestRow {
  config: ContestConfig;

  entrants: number | null;
}

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

  known: ReturnType<typeof knownGroups>;

  ruleMatches: number[] | null;
  groupCounts: Map<string, number> | null;

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

  if (!viewer.can("account.read")) {
    return { ...base, ruleMatches: null, groupCounts: null, untagged: null };
  }

  const active = await listAccounts({ status: "active" });

  const { counts: groupCounts, untagged } = tallyCohorts(active);

  const activeUids = new Set(active.map((row) => row.uid));

  return {
    ...base,
    ruleMatches: rules.map((rule) =>
      isUidsRule(rule)
        ? rule.uids.filter((uid) => activeUids.has(uid)).length
        : active.filter((row) => row.email && rule.email.test(row.email)).length,
    ),
    groupCounts,
    untagged: untagged.length,
  };
}
