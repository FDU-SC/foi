import type { GroupInput } from "@/lib/auth/groups";
import type {
  EnrollmentPolicyInput,
  EnrollmentRuleInput,
} from "@/lib/enrollment/types";

/**
 * Who may register, and what each group may do.
 *
 * The skeleton needs a privileged group because every kernel case that wants
 * an administrator's viewer resolves one by capability — see `viewerWith` in
 * `test/content-shapes.ts` — and needs the entrant group its example round
 * restricts entry to.
 */
export const policy: EnrollmentPolicyInput = {
  enabled: true,
  // `next start` is production, and production is where `assertMailDelivery`
  // refuses to boot without a relay. Saying "console" out loud is the answer
  // that check is asking for, and it is what lets the swap job run a build.
  mailDelivery: "console",
  emailDomains: ["example.test"],
  // At least one, because a handle a rule can grant a privileged group to has
  // to be one registration cannot hand out first. `content/deployment.test.ts`
  // asserts the list is non-empty for that reason.
  reservedHandles: ["root", "admin"],
  registrationsPerIpPerHour: 10,
};

export const groups: GroupInput[] = [
  {
    id: "管理员",
    description: "完整权限，供内核的运维台与门禁用例解析出一个持有者。",
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

export const rules: EnrollmentRuleInput[] = [
  // By address, so it cannot grant capabilities: a regex covers an unbounded
  // set of mailboxes and nothing can reserve them at registration.
  {
    label: "参赛者",
    email: /@example\.test$/i,
    groups: ["参赛者"],
  },
  // By handle, which is the only shape allowed to grant a privileged group,
  // because a finite list of names is one the registration flow can hold back.
  {
    label: "管理员",
    handles: ["admin"],
    groups: ["管理员"],
  },
];
