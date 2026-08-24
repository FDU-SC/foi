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
 * There used to be two arrays here. `rules` matched an address and could not
 * confer privilege; `grants` named a handle and was the only thing that could.
 * They were one mechanism wearing two shapes — a grant is a rule whose
 * condition happens to be "this exact handle" — so they are one array now, and
 * the safety property is stated against the *condition* instead of against
 * which array something was written in. See `privilegeAllowed` below.
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
 * The whole of the old rule/grant split, kept as a checked property rather
 * than as a structural accident. There is no `disabled` counterpart:
 * suspending an account is a moderation decision and lives in the database, so
 * that banning a spam signup does not require a commit.
 */
export function privilegeAllowed(rule: EnrollmentRule): boolean {
  return isHandlesRule(rule);
}

export const enrollmentPolicySchema = z.object({
  /** Turns the registration form off without removing the route. */
  enabled: z.boolean().default(true),

  /**
   * Addresses that may register. Empty means any, which is almost never what
   * a school deployment wants: the domain allowlist is the first gate, and the
   * cohort rules are the second.
   */
  emailDomains: z.array(z.string().min(1)).default([]),

  /**
   * Whether the registration form mails a code and requires it back before it
   * will create anything. Off is for deployments that pre-verify some other
   * way; leaving it off with a public form means anybody can claim any
   * address, and addresses decide group membership.
   */
  requireEmailVerification: z.boolean().default(true),

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
