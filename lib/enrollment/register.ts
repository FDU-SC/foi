import {
  createAccount,
  findAccountByEmail,
  getAccount,
} from "@/lib/accounts/queries";
import { normalizeEmail, normalizeHandle } from "@/lib/accounts/types";
import { setPassword } from "@/lib/auth/credentials";
import { checkRegistrationProof } from "@/lib/auth/registration-proof";
import {
  consumeVerifiedEmail,
  isEmailVerified,
} from "@/lib/auth/email-verification";
import { enrollmentPolicy, rulesForHandle } from "./registry";

/**
 * Turning a filled-in form into an account.
 *
 * Kept out of the server action so that the rules about who may register are
 * stated once, in one readable sequence, rather than interleaved with form
 * plumbing — and so the action is left doing only what actions should:
 * validating input, rate limiting, and deciding what to say.
 *
 * Owning the address is one of those rules, so it is checked here rather than
 * in the action. The form does prove the address first, but a form is not a
 * gate — anything that can post to the action would otherwise be past it.
 * The verified row is only half of that gate: it is a fact about the
 * mailbox. The proof cookie is the other half, and names the browser that
 * typed the code.
 */
export type RegisterRejection =
  | "disabled"
  | "handle-taken"
  | "handle-reserved"
  | "email-domain"
  | "email-taken"
  | "email-unverified";

export type RegisterResult =
  | { ok: true; handle: string; displayName: string; email: string }
  | { ok: false; reason: RegisterRejection };

/**
 * Exported because the code has to be gated on it too. Mailing a code to an
 * address that will be turned away at the end is a round trip spent to learn
 * nothing, and the same rule stated twice would eventually be two rules.
 */
export function domainAllowed(email: string): boolean {
  const allowed = enrollmentPolicy.emailDomains;
  if (allowed.length === 0) return true;

  const domain = email.slice(email.lastIndexOf("@") + 1);
  // Subdomains count: listing `example.edu` admits `mail.example.edu`, which
  // is what an institution with several mail hosts expects.
  return allowed.some(
    (candidate) =>
      domain === candidate.toLowerCase() ||
      domain.endsWith(`.${candidate.toLowerCase()}`),
  );
}

/**
 * A handle that is reserved, already taken, or already named by a rule.
 *
 * The last is the one that matters most, and it is what lets a `handles` rule
 * confer capabilities at all: a rule naming somebody is a membership waiting
 * to be claimed, so letting a stranger register `admin` before the
 * administrator does would hand them the group the rule was written for. An
 * `email` rule gets no such protection because the set of addresses a pattern
 * covers cannot be reserved — hence it may confer nothing.
 */
async function handleAvailable(handle: string): Promise<RegisterRejection | null> {
  if (enrollmentPolicy.reservedHandles.some((r) => normalizeHandle(r) === handle)) {
    return "handle-reserved";
  }
  if (rulesForHandle(handle).length > 0) return "handle-reserved";
  if (await getAccount(handle)) return "handle-taken";
  return null;
}

export async function register(input: {
  handle: string;
  displayName: string;
  email: string;
  password: string;
  /**
   * Issued to the browser that typed the code back. Required whenever
   * verification is on: the verified row is a fact about the mailbox, and
   * without this anyone who notices a recently proven address can finish
   * the form first.
   */
  proof?: string;
}): Promise<RegisterResult> {
  if (!enrollmentPolicy.enabled) return { ok: false, reason: "disabled" };

  const handle = normalizeHandle(input.handle);
  const email = normalizeEmail(input.email, {
    stripSubaddress: enrollmentPolicy.stripSubaddress,
  });

  const unavailable = await handleAvailable(handle);
  if (unavailable) return { ok: false, reason: unavailable };

  if (!domainAllowed(email)) return { ok: false, reason: "email-domain" };
  if (await findAccountByEmail(email)) return { ok: false, reason: "email-taken" };

  if (enrollmentPolicy.requireEmailVerification) {
    // Both halves: the row says the address was proven, the proof says it
    // was this browser. Either one alone is "email-unverified" — naming
    // the cookie would tell a probe that the address is currently proven.
    const verified = await isEmailVerified(email);
    if (!verified || !checkRegistrationProof(email, input.proof)) {
      return { ok: false, reason: "email-unverified" };
    }
  }

  const account = await createAccount({
    handle,
    displayName: input.displayName,
    email,
    source: "registration",
    // Active from the first moment, which is the point of proving the address
    // beforehand: there is no window in which an account exists but may not
    // act, and so no half-made account to sweep up afterwards.
    status: "active",
    emailVerifiedAt: new Date(),
  });

  // Lost the race for the handle or the address between the checks above and
  // the insert. The unique constraints are what actually decide it.
  if (!account) {
    return {
      ok: false,
      reason: (await findAccountByEmail(email)) ? "email-taken" : "handle-taken",
    };
  }

  await setPassword(handle, input.password);

  // Spent. `accounts.email_verified_at` carries the fact from here on, and the
  // proof itself is one more copy of an address with nothing left to do.
  await consumeVerifiedEmail(email);

  return { ok: true, handle, displayName: account.displayName, email };
}
