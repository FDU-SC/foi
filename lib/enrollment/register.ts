import {
  createAccount,
  findAccountByEmail,
  getAccount,
} from "@/lib/accounts/queries";
import { setPassword } from "@/lib/accounts/password";
import { normalizeEmail, normalizeHandle } from "@/lib/accounts/types";
import { db } from "@/lib/db";
import { consumeVerifiedEmail, isEmailVerified } from "./email-verification";
import { checkRegistrationProof } from "./registration-proof";
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
 *
 * The two rejections stay separate here and are the same sentence to the
 * person filling in the form — see `REJECTIONS` in `app/register/actions.ts`.
 * Which handles a rule names is exactly the list an attacker would want, and
 * the reserved check runs first precisely so those names never reach the
 * lookup; telling them apart outward would hand the list back a guess at a
 * time. Inward they are worth distinguishing, because only one of them is
 * something an operator wrote down.
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
   * Issued to the browser that typed the code back. Checked whenever
   * verification is on: the verified row is a fact about the mailbox, and
   * without this anyone who notices a recently proven address can finish
   * the form first.
   *
   * Required rather than optional even though it may be absent. A caller
   * with no cookie to offer has to say `undefined` out loud, the same way
   * nothing in this codebase can ask an access layer a question without
   * naming a viewer — an optional field is one a new call site can forget,
   * and forgetting this one silently reopens the race.
   */
  proof: string | undefined;
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

  // Both halves, and unconditionally. The row says the address was proven, the
  // proof says it was this browser. Either one alone is "email-unverified" —
  // naming the cookie would tell a probe that the address is currently proven.
  // Not behind a policy flag: see `RETIRED_POLICY_KEYS` in
  // `lib/enrollment/types.ts` for why this is not a deployment's call.
  const verified = await isEmailVerified(email);
  if (!verified || !checkRegistrationProof(email, input.proof)) {
    return { ok: false, reason: "email-unverified" };
  }

  // The three writes are one act, so they commit or they do not.
  //
  // Run separately they have two ways to come apart, and both leave the person
  // worse off than a plain failure would: a crash after the insert gives an
  // account with no password — it exists, it cannot log in, and the form
  // now says the handle is taken by somebody who turns out to be them — and a
  // crash before the last statement leaves a proof standing for an address that
  // has already been spent. Neither is swept up by anything.
  //
  // The read inside goes through `tx` too. A statement issued on the pool
  // while a transaction is open takes a second connection out of a pool of
  // ten, so enough concurrent registrations would each be holding one and
  // queueing for another.
  return db.transaction<RegisterResult>(async (tx) => {
    const account = await createAccount(
      {
        handle,
        displayName: input.displayName,
        email,
        source: "registration",
        // Active from the first moment, which is the point of proving the
        // address beforehand: there is no window in which an account exists
        // but may not act, and so no half-made account to sweep up afterwards.
        status: "active",
        emailVerifiedAt: new Date(),
      },
      tx,
    );

    // Lost the race for the handle or the address between the checks above and
    // the insert. The unique constraints are what actually decide it. Nothing
    // was written — `onConflictDoNothing` leaves the transaction usable — so
    // returning here and letting it commit is the same as rolling back.
    if (!account) {
      return {
        ok: false,
        reason: (await findAccountByEmail(email, tx))
          ? "email-taken"
          : "handle-taken",
      };
    }

    await setPassword(handle, input.password, tx);

    // Spent. `accounts.email_verified_at` carries the fact from here on, and
    // the proof itself is one more copy of an address with nothing left to do.
    await consumeVerifiedEmail(email, tx);

    return { ok: true, handle, displayName: account.displayName, email };
  });
}
