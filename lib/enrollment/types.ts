import { z } from "zod";
import { handleSchema } from "@/lib/accounts/types";

/**
 * The declarative half of "who may do what", now that people sign themselves
 * up and the repository can no longer hold a list of them.
 *
 * What it holds instead is the rules that sort them. A regex over an address
 * is a better fit for "everyone who matriculated in 2023" than two hundred
 * names would be: it is shorter, it cannot go stale, and it says why somebody
 * is in a cohort rather than merely that they are.
 *
 * One array rather than two, because a grant is a rule whose condition happens
 * to be "this exact handle". The safety property is therefore stated against
 * the *condition* rather than against which array something was written in —
 * see `privilegeAllowed` below.
 */

/** What the groups of a matched rule are, literal or computed from captures. */
const groupsSchema = z.union([
  z.array(z.string().min(1)),
  z.function({
    input: [z.custom<RegExpMatchArray>()],
    output: z.array(z.string()),
  }),
]);

/**
 * A cohort rule keyed on the address.
 *
 * Groups may be computed from the capture groups, which is what makes one rule
 * cover every intake year instead of one rule per year.
 */
const emailRuleSchema = z.object({
  /** Shown in `/admin` and read in review. Say who the rule is for. */
  label: z.string().min(1).max(64),
  email: z.instanceof(RegExp),
  groups: groupsSchema,
});

/**
 * A rule keyed on a finite list of handles.
 *
 * This is the only shape that may confer capabilities, and the reason is not
 * that naming people is safer in the abstract — it is that a finite list can
 * be reserved. `handleAvailable` in `./register.ts` refuses to register any
 * handle named here, so "this rule matched" means "this is the person the
 * repository meant". The set a pattern covers is infinite and cannot be
 * reserved, which is why `email` rules confer nothing.
 */
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

/**
 * Whether this rule's condition is one the repository can vouch for.
 *
 * A checked property rather than a structural accident. There is no `disabled`
 * counterpart: suspending an account is a moderation decision and lives in the
 * database, so that banning a spam signup does not require a commit.
 */
export function privilegeAllowed(rule: EnrollmentRule): boolean {
  return isHandlesRule(rule);
}

export const enrollmentPolicySchema = z.object({
  /** Turns the registration form off without removing the route. */
  enabled: z.boolean().default(true),

  /**
   * Where mail goes: a real relay, or the server log.
   *
   * Declared rather than inferred from `FOI_SMTP_HOST` being absent, because
   * that inference cannot tell a laptop apart from a production box deployed
   * without its mail configuration: both take the console branch in
   * `lib/mail/transport.ts`, which prints the message and reports success, so
   * registration and recovery announce themselves as working while every code
   * and every reset link goes to the container log.
   *
   * `console` is a real answer rather than a degraded one. A fresh checkout
   * runs the whole registration flow with no mail server standing by, and it
   * is the documented escape hatch for a deployment whose relay is not ready:
   * the codes land in the log until it is. What it must not be is what a
   * deployment gets by forgetting something, which is why the default is
   * `smtp` and `mailDeliveryComplaints` reports having no relay behind it.
   *
   * That refusal only bites on `prod`, and the reason is the default
   * itself. `content/enrollment/example.ts` names no `mailDelivery`, so it
   * takes `smtp`, and enforcing everywhere would stop a fresh checkout with
   * no SMTP from starting at all — breaking the one setup the README points a
   * newcomer at. Outside production a missing relay therefore falls back to
   * `console` with a warning.
   */
  mailDelivery: z.enum(["smtp", "console"]).default("smtp"),

  /**
   * Addresses that may register. Empty means any, which is almost never what
   * a school deployment wants: the domain allowlist is the first gate, and the
   * cohort rules are the second.
   */
  emailDomains: z.array(z.string().min(1)).default([]),

  /*
   * There is no `requireEmailVerification` here, and that is deliberate. See
   * `retiredPolicyKey` at the bottom of this file for why, and for what a
   * deployment still carrying it is told.
   */

  /** Names that would be confusing or impersonating in a standings table. */
  reservedHandles: z.array(z.string()).default([]),

  /**
   * Whether `user+anything@host` is folded onto `user@host`. On by default:
   * one mailbox must not be able to become several accounts in several
   * cohorts. See the note in `lib/accounts/types.ts`.
   */
  stripSubaddress: z.boolean().default(true),

  /** Registrations accepted from one address, per hour. */
  registrationsPerIpPerHour: z.number().int().positive().default(10),
});

export type EnrollmentPolicy = z.infer<typeof enrollmentPolicySchema>;
export type EnrollmentPolicyInput = z.input<typeof enrollmentPolicySchema>;

/**
 * Options a policy file may still name that no longer exist.
 *
 * `requireEmailVerification` was a boolean defaulting to true. Proving the
 * address is not a thing a deployment gets to decide, for the reason
 * `lib/auth/email-verification.ts` gives about its own attempt cap: some
 * settings are security parameters rather than deployment policy. Here the
 * stake is sharper than a weak cap — an address decides which cohort somebody
 * lands in, and a cohort decides which contests they may enter, so an unproven
 * address is an unproven claim to a seat in a round.
 *
 * Reported rather than ignored because `z.object` strips unknown keys in
 * silence, and the direction that matters is `false`: that deployment believed
 * addresses went unproven, and the answer has changed underneath it.
 */
const RETIRED_POLICY_KEYS: Record<string, string> = {
  requireEmailVerification:
    "的注册策略里还有 requireEmailVerification，这个选项已经取消。" +
    "证明邮箱地址不再是部署可以选择的事——地址决定分组，分组决定参赛资格，" +
    "所以未经证明的地址就是一份未经证明的参赛资格。删掉这一行即可；" +
    "如果原本设的是 false，请注意注册流程现在一律要求验证码。" +
    "不想依赖邮件的部署应当用 enabled: false 配 scripts/create-account.cjs。",
};

/** The complaint for the first retired key this policy names, or null. */
export function retiredPolicyKey(policy: unknown): string | null {
  if (typeof policy !== "object" || policy === null) return null;

  for (const [key, complaint] of Object.entries(RETIRED_POLICY_KEYS)) {
    if (key in policy) return complaint;
  }
  return null;
}
