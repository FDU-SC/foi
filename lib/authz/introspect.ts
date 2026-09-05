import { ACTIONS, ACTION_IDS, type ActionId } from "./actions";
import { allPolicies } from "./registry";
import type { CompiledPolicy, Effect } from "./types";

/**
 * Reading the policy set as data.
 *
 * Because a policy's scope is declarative, the platform can answer questions
 * about who holds power without running anything — which is what keeps the
 * enrollment guard honest and lets the admin console show the whole picture.
 */

let privileged: Set<string> | null = null;

/**
 * Group ids that some policy grants something to.
 *
 * This is the definition of "privileged" the enrollment guard enforces: an
 * email pattern matches an unbounded set of addresses, so a typo in a regex
 * would hand these groups to everyone who happens to match.
 */
export function privilegedGroups(): Set<string> {
  if (privileged) return privileged;

  const ids = new Set<string>();
  for (const entry of allPolicies()) {
    if (entry.effect !== "permit") continue;

    const principal = entry.principal;
    if (!principal) continue;

    if ("group" in principal) ids.add(principal.group);
    else if ("anyGroup" in principal) {
      for (const id of principal.anyGroup) ids.add(id);
    }
  }

  return (privileged = ids);
}

export function isPrivilegedGroup(id: string): boolean {
  return privilegedGroups().has(id);
}

/** Actions nothing can ever satisfy — a gate wired to a dead question. */
export function actionsWithoutPermit(): ActionId[] {
  const permitted = new Set<ActionId>();
  for (const entry of allPolicies()) {
    if (entry.effect !== "permit") continue;
    for (const action of entry.actions) permitted.add(action);
  }

  return ACTION_IDS.filter((action) => !permitted.has(action));
}

export interface PolicyRow {
  id: string;
  effect: Effect;
  describe: string;
  principal: string;
  conditional: boolean;
}

function describePrincipal(entry: CompiledPolicy): string {
  const principal = entry.principal;
  if (!principal) return "所有人";
  if ("group" in principal) return principal.group;
  if ("anyGroup" in principal) return principal.anyGroup.join("、");
  if ("authenticated" in principal) return "已登录的人";
  return "资源的所有者";
}

/** The whole policy set, grouped by action, for the admin console. */
export function policyMatrix(): {
  action: ActionId;
  describe: string;
  policies: PolicyRow[];
}[] {
  const byAction = new Map<ActionId, PolicyRow[]>(
    ACTION_IDS.map((action) => [action, []]),
  );

  for (const entry of allPolicies()) {
    const row: PolicyRow = {
      id: entry.id,
      effect: entry.effect,
      describe: entry.describe,
      principal: describePrincipal(entry),
      conditional: entry.when !== undefined,
    };
    for (const action of entry.actions) byAction.get(action)?.push(row);
  }

  return ACTION_IDS.map((action) => ({
    action,
    describe: ACTIONS[action].describe,
    policies: byAction.get(action) ?? [],
  }));
}

export function policyWarnings(): string[] {
  return actionsWithoutPermit().map(
    (action) =>
      `动作 "${action}"（${ACTIONS[action].describe}）没有任何 permit。`,
  );
}
