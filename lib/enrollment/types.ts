import { z } from "zod";

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

const uidsRuleSchema = z.object({
  label: z.string().min(1).max(64),
  uids: z.array(z.number().int().positive()).min(1),
  groups: z.array(z.string().min(1)),
});

export const enrollmentRuleSchema = z.union([
  emailRuleSchema,
  uidsRuleSchema,
]);

export type EnrollmentRule = z.infer<typeof enrollmentRuleSchema>;
export type EnrollmentRuleInput = z.input<typeof enrollmentRuleSchema>;

export type EmailRule = z.infer<typeof emailRuleSchema>;
export type UidsRule = z.infer<typeof uidsRuleSchema>;

export function isUidsRule(rule: EnrollmentRule): rule is UidsRule {
  return "uids" in rule;
}

/**
 * How an address becomes an account. Whether registration is open at all is a
 * separate question, answered by the `account.register` policy.
 */
export const enrollmentPolicySchema = z.object({

  emailDomains: z.array(z.string().min(1)).default([]),

  stripSubaddress: z.boolean().default(true),
});

export type EnrollmentPolicy = z.infer<typeof enrollmentPolicySchema>;
export type EnrollmentPolicyInput = z.input<typeof enrollmentPolicySchema>;

