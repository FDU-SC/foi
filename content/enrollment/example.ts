import type { GroupInput } from "@/lib/auth/groups";
import type {
  EnrollmentPolicyInput,
  EnrollmentRuleInput,
} from "@/lib/enrollment/types";

/**
 * How people get in, and what they get when they do. The rules are here; the
 * people are in the `accounts` table. See the README's 「注册、分流与权限」.
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

  // This example runs no relay, so it says so. **Leaving this line out breaks
  // a fresh checkout**: `next start` is production, and production is where
  // `assertMailDelivery` throws rather than warns. A real deployment changes
  // it to `"smtp"` and sets `FOI_SMTP_HOST`; forgetting to is not silent,
  // because `/admin` reports an unconfigured relay off the environment rather
  // than off this line.
  mailDelivery: "console",

  registrationsPerIpPerHour: 10,
};

/**
 * What each group may do. Only groups carrying capabilities go here; a group
 * that appears only in a rule below is an ordinary cohort, which is what makes
 * adding one free. The capability names come from `lib/auth/policy.ts`.
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
      "submission.rejudge",
      "backend.inspect",
      "account.read",
      "credential.manage",
      "account.moderate",
    ],
  },
];

/**
 * Which groups somebody ends up in. Every matching rule contributes, and
 * membership is recomputed on every read.
 *
 * **The shape of a rule decides what it may confer**: `email` covers a whole
 * intake with one line and can produce plain cohorts only; `handles` may
 * produce capability-bearing groups, because registration reserves every
 * handle named here and a finite list is therefore something the repository
 * can actually point at. The registry refuses to load an `email` rule naming a
 * privileged group, and drops any such group a computed rule returns at
 * runtime.
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
