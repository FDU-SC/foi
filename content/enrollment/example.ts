import type { GroupInput } from "@/lib/auth/groups";
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
  reservedHandles: ["root", "system", "admin", "foi", "judge", "support"],

  registrationsPerIpPerHour: 10,
};

/**
 * What each group may do.
 *
 * This is the file half of "哪个组能干什么". A group listed here with
 * capabilities can do those things; a group that appears only in a rule or a
 * grant below is an ordinary cohort and can do nothing — which is what makes
 * adding one free.
 *
 * The capability names come from `lib/auth/policy.ts`. That list is the
 * kernel's, because the code reads those identifiers; which groups exist and
 * what each may do is yours.
 */
export const groups: GroupInput[] = [
  {
    id: "管理员",
    description: "完整权限：预览未公开题目、查看评测机与全部提交、管理凭据与账号。",
    capabilities: [
      "admin.access",
      "problem.viewAll",
      "contest.viewAll",
      "standings.viewFrozen",
      "submission.readAny",
      "backend.inspect",
      "account.read",
      "credential.manage",
      "account.moderate",
      "registry.sync",
    ],
  },
];

/**
 * Which groups an address puts somebody in.
 *
 * Every matching rule contributes, so one person can be in an intake year and
 * a programme at once. Membership is recomputed on every read: edit a rule
 * here, deploy, and everyone it covers is re-sorted on their next request
 * without a migration or a backfill.
 *
 * Contests select their entrants by group, which is the whole point — a cohort
 * is described once here rather than pasted into every contest file.
 *
 * A rule may not name a group declared with capabilities above; the registry
 * refuses to load one that does. A regex is the wrong instrument for handing
 * out privilege — get a digit wrong and a whole intake becomes administrators.
 */
export const rules: EnrollmentRuleInput[] = [
  {
    label: "示例：按入学年份分流",
    // 学号 11 位，前两位是入学年份：23300240001@example.test → 2023级。
    // 位数一定要跟真实学号对齐——少数一位，这条规则在 code review 里看着完全
    // 正常，在生产里一个人也匹配不上。`/admin/enrollment` 的「命中账号」列就
    // 是为了让这种错误在开赛前暴露出来。
    match: /^(\d{2})30\d{7}@example\.test$/i,
    groups: (m) => [`20${m[1]}级`, "本科生"],
  },
  {
    label: "示例：演示账号",
    match: /@example\.test$/i,
    groups: ["demo"],
  },
];

/**
 * Who is in which group, by name.
 *
 * The only way into a privileged group. Naming the person is the point — it is
 * what makes the change reviewable, and what leaves the reason in the git
 * history. Ordinary cohorts can be granted here too, for the person a rule
 * does not happen to cover.
 *
 * `admin` here is the bootstrap administrator. Entries with a `displayName`
 * are materialised as accounts at startup — this one has no email and gets its
 * password from `scripts/set-password.cjs`, because the very first deploy has
 * nobody who could send a reset through the UI.
 */
export const grants: GrantInput[] = [
  { handle: "admin", displayName: "管理员", groups: ["管理员"] },
];
