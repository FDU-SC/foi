import type { GroupInput } from "@/lib/auth/groups";
import type {
  EnrollmentPolicyInput,
  EnrollmentRuleInput,
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

  // Names that would be confusing or outright impersonating on a standings
  // page. Handles named by a rule below are reserved automatically.
  reservedHandles: ["root", "system", "admin", "foi", "judge", "support"],

  // Said out loud rather than left to be inferred from a missing variable,
  // which is the entire point of this field. This example runs no relay — the
  // quick start does not ask for one, and `emailDomains` here is a reserved
  // test domain — so it is a deployment that prints codes to the log, and the
  // config should be the place that says so.
  //
  // A real deployment changes this to `"smtp"` and sets `FOI_SMTP_HOST`.
  // Forgetting to is not silent: `/admin` reports an unconfigured relay
  // whatever the policy says, because that finding reads the environment
  // rather than this line.
  //
  // Leaving it out would make `pnpm build && pnpm start` refuse to boot on a
  // fresh checkout — production is where `assertMailDelivery` throws, and
  // `next start` is production. That is the check working, and this line is
  // the answer it is asking for.
  mailDelivery: "console",

  registrationsPerIpPerHour: 10,
};

/**
 * What each group may do.
 *
 * This is the file half of "哪个组能干什么". A group listed here with
 * capabilities can do those things; a group that appears only in a rule below
 * is an ordinary cohort and can do nothing — which is what makes adding one
 * free.
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
    ],
  },
];

/**
 * Which groups somebody ends up in.
 *
 * Every matching rule contributes, so one person can be in an intake year, a
 * programme and the setters' group at once. Membership is recomputed on every
 * read: edit a rule here, deploy, and everyone it covers is re-sorted on their
 * next request without a migration or a backfill.
 *
 * Contests select their entrants by group, which is the whole point — a cohort
 * is described once here rather than pasted into every contest file.
 *
 * A rule comes in one of two shapes, and the shape decides what it may confer:
 *
 *   email:   a pattern over the address. Covers a whole intake with one line,
 *            and confers no capabilities at all — the set of addresses a regex
 *            matches is infinite, so nothing can be reserved against it, and
 *            getting a digit wrong would turn a whole year group into
 *            administrators.
 *
 *   handles: a finite list of usernames. May confer capabilities, because a
 *            finite list *can* be reserved: registration refuses every handle
 *            named here, so a rule matching means the person is the one the
 *            repository meant rather than whoever registered the name first.
 *
 * The registry refuses to load an `email` rule that names a group carrying
 * capabilities, and drops any such group a computed rule produces at runtime.
 */
export const rules: EnrollmentRuleInput[] = [
  {
    label: "示例：按入学年份分流",
    // 学号 11 位，前两位是入学年份：23300240001@example.test → 2023级。
    // 位数一定要跟真实学号对齐——少数一位，这条规则在 code review 里看着完全
    // 正常，在生产里一个人也匹配不上。`/admin/enrollment` 的「命中账号」列就
    // 是为了让这种错误在开赛前暴露出来。
    email: /^(\d{2})30\d{7}@example\.test$/i,
    groups: (m) => [`20${m[1]}级`, "本科生"],
  },
  {
    label: "示例：演示账号",
    email: /@example\.test$/i,
    groups: ["demo"],
  },
  {
    // 生产部署把这里换成真人的用户名。第一个管理员先用
    // `scripts/create-account.cjs` 建号，再把他的 handle 写进来重新部署——
    // 名字写在这里是重点，它让这次提权在 diff 里可读，理由留在 git 历史里。
    label: "管理员",
    handles: ["admin"],
    groups: ["管理员"],
  },
];
