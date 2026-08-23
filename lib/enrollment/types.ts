import { z } from "zod";
import { handleSchema } from "@/lib/accounts/types";
import { ROLE_IDS } from "@/lib/auth/policy";

/**
 * The declarative half of "who may do what", now that people sign themselves
 * up and the repository can no longer hold a list of them.
 *
 * What it holds instead is the rules that sort them. A regex over an address
 * is a better fit for "everyone who matriculated in 2023" than two hundred
 * names would be: it is shorter, it cannot go stale, and it says why somebody
 * is in a cohort rather than merely that they are.
 */

/**
 * One cohort rule: an address pattern and the tags it confers.
 *
 * Tags may be computed from the capture groups, which is what makes one rule
 * cover every intake year instead of one rule per year. Deliberately no
 * `role` — see the note on `grantSchema`.
 */
export const enrollmentRuleSchema = z.object({
  /** Shown in `/admin` and read in review. Say who the rule is for. */
  label: z.string().min(1).max(64),
  match: z.instanceof(RegExp),
  tags: z.union([
    z.array(z.string().min(1)),
    z.function({ input: [z.custom<RegExpMatchArray>()], output: z.array(z.string()) }),
  ]),
});

export type EnrollmentRule = z.infer<typeof enrollmentRuleSchema>;
export type EnrollmentRuleInput = z.input<typeof enrollmentRuleSchema>;

/**
 * A privilege granted to one named person.
 *
 * Roles come from here and only from here. Deriving one from an address would
 * mean that a slip in a regex hands out `staff`, and the whole reason
 * authorisation stayed in the repository is that changing it should be a
 * reviewed act naming a specific person. Cohort tags carry no privilege of
 * their own, so those are safe to compute.
 *
 * There is no `disabled`: suspending an account is a moderation decision and
 * lives in the database, so that banning a spam signup does not require a
 * commit. Two ways to lock somebody out would only make it unclear which one
 * is in force.
 */
export const grantSchema = z.object({
  handle: handleSchema,
  /** Only for accounts the repository declares; registrations choose theirs. */
  displayName: z.string().min(1).max(64).optional(),
  role: z.enum(ROLE_IDS).default("user"),
  /** Added on top of whatever the address already resolves to. */
  tags: z.array(z.string()).default([]),
});

export type Grant = z.infer<typeof grantSchema>;
export type GrantInput = z.input<typeof grantSchema>;

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
   * Whether an account has to prove it owns its address before it can act.
   * Off is for deployments that pre-verify some other way; leaving it off with
   * a public form means anybody can claim any address, and addresses decide
   * cohorts.
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

  /** How long an unverified signup holds its handle before being swept. */
  unverifiedTtlHours: z.number().int().positive().default(24),

  /** Registrations accepted from one address, per hour. */
  registrationsPerIpPerHour: z.number().int().positive().default(10),
});

export type EnrollmentPolicy = z.infer<typeof enrollmentPolicySchema>;
export type EnrollmentPolicyInput = z.input<typeof enrollmentPolicySchema>;
