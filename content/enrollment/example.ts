import type {
  EnrollmentPolicyInput,
  EnrollmentRuleInput,
  GrantInput,
} from "@/lib/enrollment/types";

/**
 * How people get in, and what they get when they do.
 *
 * This is the file that replaced the roster. Listing everybody stopped being
 * possible once they could sign themselves up, and it was never the part worth
 * keeping: what the repository is for is the *decisions* — who may register,
 * which cohort an address belongs to, who is allowed to administer the thing.
 * The people themselves are in the `accounts` table, where they can arrive at
 * three in the morning without waiting for a review.
 *
 * A real deployment adds its own file next to this one — `2026-spring.ts` and
 * so on — which is also why they stay out of the public mirror: only this
 * example is on the allowlist in `.github/workflows/sync-public.yml`, and it
 * is what makes a public checkout runnable.
 */

export const policy: EnrollmentPolicyInput = {
  enabled: true,

  // The first gate. `example.test` is what `pnpm db:seed` hands the demo
  // accounts; a real deployment lists the institution's mail domains and
  // nothing else.
  emailDomains: ["example.test"],

  requireEmailVerification: true,

  // Names that would be confusing or outright impersonating on a standings
  // page. Handles already granted below are reserved automatically.
  reservedHandles: ["root", "system", "staff", "foi", "judge", "support"],

  unverifiedTtlHours: 24,
  registrationsPerIpPerHour: 10,
};

/**
 * Address to cohort.
 *
 * Every matching rule contributes its tags, so somebody can be in an intake
 * year and a programme at once. Tags are recomputed on every read: edit a rule
 * here, deploy, and everyone it covers is re-sorted on their next request
 * without a migration or a backfill.
 *
 * Contests select their entrants by tag, which is the whole point — a cohort
 * is described once here rather than pasted into every contest file.
 */
export const rules: EnrollmentRuleInput[] = [
  {
    label: "示例：按入学年份分流",
    // 23300240001@example.test → 2023级
    match: /^(\d{2})30\d{6}@example\.test$/i,
    tags: (m) => [`20${m[1]}级`, "本科生"],
  },
  {
    label: "示例：演示账号",
    match: /@example\.test$/i,
    tags: ["demo"],
  },
];

/**
 * Privileges, by name.
 *
 * Roles are never derived from an address: a slip in a regex above would
 * otherwise hand out `staff`. Naming the person is the point — it is what
 * makes the change reviewable, and what leaves the reason in the git history.
 *
 * `admin` here is the bootstrap administrator. It is materialised as an
 * account at startup with no email, and gets its password from
 * `scripts/set-password.cjs`, because the very first deploy has nobody who
 * could issue one through the UI.
 */
export const grants: GrantInput[] = [
  { handle: "admin", displayName: "管理员", role: "admin" },
];
