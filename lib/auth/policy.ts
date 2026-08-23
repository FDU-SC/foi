/**
 * Who may do what, as code.
 *
 * Roles used to be a bare string on the users row, compared against the
 * literal `"admin"` wherever a decision was needed. That put the authorisation
 * model in two places at once: the set of roles lived in the database, the
 * meaning of each role lived scattered across call sites, and neither could be
 * reviewed as a whole.
 *
 * Here the whole model is one table. A role is a named bundle of capabilities,
 * a capability is a single decision the kernel knows how to make, and every
 * call site asks `can(user, capability)` instead of naming a role. Widening or
 * narrowing what a role may do is a diff against this file.
 */

/**
 * Every distinct authorisation decision in the kernel.
 *
 * Keep these coarse. A capability should describe a thing a person does, not
 * an endpoint they hit, so that adding a second route for the same activity
 * does not require a new entry.
 */
export const CAPABILITIES = [
  /** Reach the /admin operations console at all. */
  "admin.access",
  /** See judge addresses and unredacted queue entries. */
  "judge.inspect",
  /** Read submissions belonging to other people. */
  "submission.readAny",
  /** Push the filesystem registries into their mirror tables by hand. */
  "registry.sync",
  /** Issue setup codes and reset passwords. */
  "credential.manage",
  /**
   * Suspend and reinstate accounts.
   *
   * Separate from `credential.manage` because they answer different questions:
   * one is "help this person get back in", the other is "keep this person
   * out". Handing over the first should not imply the second.
   */
  "account.moderate",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export interface RoleDefinition {
  /** Shown in the UI wherever a role is displayed. */
  name: string;
  description: string;
  capabilities: readonly Capability[];
}

/**
 * A grant's `role` field must name one of these.
 *
 * `staff` exists to make the point that the middle ground is now free: it can
 * watch the judges and read everyone's submissions without being handed the
 * ability to reset passwords or lock people out. Before capabilities, that
 * role would have needed a schema change.
 */
export const ROLES = {
  admin: {
    name: "管理员",
    description: "完整权限，包括凭据管理、账号封禁与注册表同步。",
    capabilities: [...CAPABILITIES],
  },
  staff: {
    name: "助教",
    description: "可查看判题机细节与全部提交，但不能管理凭据或封禁账号。",
    capabilities: ["admin.access", "judge.inspect", "submission.readAny"],
  },
  user: {
    name: "选手",
    description: "只能读写自己的提交。",
    capabilities: [],
  },
} as const satisfies Record<string, RoleDefinition>;

export type RoleId = keyof typeof ROLES;

export const ROLE_IDS = Object.keys(ROLES) as [RoleId, ...RoleId[]];

export function isRoleId(value: unknown): value is RoleId {
  return typeof value === "string" && value in ROLES;
}

/** Display name for a role, falling back to the raw id if it ever drifts. */
export function roleName(role: string): string {
  return isRoleId(role) ? ROLES[role].name : role;
}

/**
 * Takes the role rather than a full session user so that this module stays
 * free of imports — `lib/auth/session.ts` depends on it, not the other way
 * round, and the proxy can evaluate it on the edge.
 */
export function can(
  user: { role: RoleId } | null | undefined,
  capability: Capability,
): boolean {
  if (!user) return false;
  // Widened deliberately: `as const` gives each role a distinct tuple type, so
  // indexing by a union narrows `includes` to the empty intersection.
  const granted: readonly Capability[] = ROLES[user.role].capabilities;
  return granted.includes(capability);
}

export function listRoles(): { id: RoleId; definition: RoleDefinition }[] {
  return ROLE_IDS.map((id) => ({ id, definition: ROLES[id] }));
}
