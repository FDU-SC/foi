import { z } from "zod";
import { handleSchema } from "@/lib/accounts/types";

const groupsSchema = z.union([
  z.array(z.string().min(1)),
  z.function({
    input: [z.custom<RegExpMatchArray>()],
    output: z.array(z.string()),
  }),
]);

const emailRuleSchema = z.object({

  label: z.string().min(1).max(64),
  email: z.instanceof(RegExp),
  groups: groupsSchema,
});

const handlesRuleSchema = z.object({
  label: z.string().min(1).max(64),
  handles: z.array(handleSchema).min(1),
  groups: z.array(z.string().min(1)),
});

export const enrollmentRuleSchema = z.union([
  emailRuleSchema,
  handlesRuleSchema,
]);

export type EnrollmentRule = z.infer<typeof enrollmentRuleSchema>;
export type EnrollmentRuleInput = z.input<typeof enrollmentRuleSchema>;

export type EmailRule = z.infer<typeof emailRuleSchema>;
export type HandlesRule = z.infer<typeof handlesRuleSchema>;

export function isHandlesRule(rule: EnrollmentRule): rule is HandlesRule {
  return "handles" in rule;
}

export const enrollmentPolicySchema = z.object({

  enabled: z.boolean().default(true),

  mailDelivery: z.enum(["smtp", "console"]).default("smtp"),

  emailDomains: z.array(z.string().min(1)).default([]),

  reservedHandles: z.array(z.string()).default([]),

  stripSubaddress: z.boolean().default(true),

  registrationsPerIpPerHour: z.number().int().positive().default(10),
});

export type EnrollmentPolicy = z.infer<typeof enrollmentPolicySchema>;
export type EnrollmentPolicyInput = z.input<typeof enrollmentPolicySchema>;

const RETIRED_POLICY_KEYS: Record<string, string> = {
  requireEmailVerification:
    "的注册策略里还有 requireEmailVerification，这个选项已经取消。" +
    "证明邮箱地址不再是部署可以选择的事——地址决定分组，分组决定参赛资格，" +
    "所以未经证明的地址就是一份未经证明的参赛资格。删掉这一行即可；" +
    "如果原本设的是 false，请注意注册流程现在一律要求验证码。" +
    "不想依赖邮件的部署应当用 enabled: false 配 scripts/create-account.cjs。",
};

export function retiredPolicyKey(policy: unknown): string | null {
  if (typeof policy !== "object" || policy === null) return null;

  for (const [key, complaint] of Object.entries(RETIRED_POLICY_KEYS)) {
    if (key in policy) return complaint;
  }
  return null;
}
