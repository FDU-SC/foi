import type { GroupInput } from "@/lib/permissions/groups";
import type {
  EnrollmentPolicyInput,
  EnrollmentRuleInput,
} from "@/lib/enrollment/types";

export const policy: EnrollmentPolicyInput = {
  enabled: true,

  emailDomains: ["example.test"],

  reservedHandles: ["root", "system", "admin", "foi", "judge", "support"],

  mailDelivery: "console",

  registrationsPerIpPerHour: 10,
};

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

export const rules: EnrollmentRuleInput[] = [
  {
    label: "示例：按入学年份分流",

    email: /^(\d{2})30\d{7}@example\.test$/i,
    groups: (m) => [`20${m[1]}级`, "本科生"],
  },
  {
    label: "示例：演示账号",
    email: /@example\.test$/i,
    groups: ["demo"],
  },
  {

    label: "管理员",
    handles: ["admin"],
    groups: ["管理员"],
  },
];
