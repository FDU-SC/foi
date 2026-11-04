import { allows } from "@/lib/authz/engine";
import { canQueryAny } from "@/lib/authz/filter";
import type { Viewer } from "@/lib/authz/viewer";
import {
  accountDirectoryFor,
  accountsFor,
  type AccountDirectory,
} from "@/lib/accounts/access";
import { listBackendIds } from "@/lib/backend/registry";
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
import { listRunnerTokens, type RunnerTokenListing } from "@/lib/runner/tokens";
import { loadAdminOverview, type AdminOverview } from "./drift";

export async function adminOverviewFor(
  viewer: Viewer,
): Promise<AdminOverview | null> {
  if (!allows("admin.enter", null, viewer)) return null;
  return loadAdminOverview();
}

export async function adminAccountsFor(
  viewer: Viewer,
): Promise<AccountDirectory | null> {
  if (!allows("admin.enter", null, viewer)) return null;
  return accountDirectoryFor(viewer);
}

export interface AdminContestRow {
  config: ContestConfig;

  entrants: number | null;
}

export async function adminContestsFor(
  viewer: Viewer,
): Promise<AdminContestRow[] | null> {
  if (!allows("admin.enter", null, viewer)) return null;

  return Promise.all(
    allContests().map(async (config) => ({
      config,
      entrants: (await resolveParticipants(config))?.length ?? null,
    })),
  );
}

export interface RunnerTokenGroup {
  backendId: string;
  tokens: RunnerTokenListing[];
}

/** One entry per backend whose tokens the viewer may manage. */
export async function adminRunnerTokensFor(
  viewer: Viewer,
): Promise<RunnerTokenGroup[] | null> {
  if (!allows("admin.enter", null, viewer)) return null;

  const manageable = listBackendIds().filter((id) =>
    allows("backend.manageTokens", { id }, viewer),
  );
  const tokens = await listRunnerTokens(manageable);

  return manageable.map((backendId) => ({
    backendId,
    tokens: tokens.filter((token) => token.backendId === backendId),
  }));
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
  if (!allows("admin.enter", null, viewer)) return null;

  const rules = listRules();
  const base = {
    policy: enrollmentPolicy,
    rules,
    known: knownGroups(),
  };

  if (!canQueryAny("account.read", viewer)) {
    return { ...base, ruleMatches: null, groupCounts: null, untagged: null };
  }

  const active = await accountsFor(viewer, { status: "active" });

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
