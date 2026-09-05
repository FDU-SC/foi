import type { GroupInput } from "@/lib/authz/groups";
import type {
  EnrollmentPolicyInput,
  EnrollmentRuleInput,
} from "@/lib/enrollment/types";

export const policy: EnrollmentPolicyInput = {
  emailDomains: ["example.test"],
};

/**
 * 用户组只是标签。「管理员」能做什么写在 content/policies/staff.ts 里，
 * 这里声明的只是它的显示名与说明。
 */
export const groups: GroupInput[] = [
  {
    id: "管理员",
    description: "运维组：预览未公开题目、查看评测机与全部提交、管理凭据与账号。",
  },
  {
    id: "监考",
    description: "只看运行状况：运维台的配置漂移与评测队列，不含账号目录与邮箱。",
  },
  {
    id: "演示账号",
    description:
      "公开试用账号：照常做题与提交，但凭据由每夜重建维护，谁都改不动。",
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
    // 上面那条把整个域都算作演示赛的参赛者，本地开发的账号也在内。这条只圈出
    // scripts/demo-seed.cjs 建出来的那几个公用账号，content/policies/demo.ts
    // 据此冻结它们的凭据。命名形状跟着 demo-seed 的 --prefix 与 EMAIL_DOMAIN 走，
    // 两处要一起改。
    label: "公开演示账号",
    email: /^demo\d+@example\.test$/i,
    groups: ["演示账号"],
  },
];
