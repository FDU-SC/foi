import {
  createAccount,
  findAccountByEmail,
  getAccount,
} from "@/lib/accounts/queries";
import { normalizeEmail, normalizeHandle } from "@/lib/accounts/types";
import { setPassword } from "@/lib/auth/credentials";
import { enrollmentPolicy, getGrant } from "./registry";

/**
 * Turning a filled-in form into an account.
 *
 * Kept out of the server action so that the rules about who may register are
 * stated once, in one readable sequence, rather than interleaved with form
 * plumbing — and so the action is left doing only what actions should:
 * validating input, rate limiting, and deciding what to say.
 */
export type RegisterRejection =
  | "disabled"
  | "handle-taken"
  | "handle-reserved"
  | "email-domain"
  | "email-taken";

export type RegisterResult =
  | { ok: true; handle: string; displayName: string; email: string }
  | { ok: false; reason: RegisterRejection };

function domainAllowed(email: string): boolean {
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
 * A handle that is reserved, already taken, or already promised to somebody by
 * a grant. The last is the one that matters most: a grant is a privilege
 * waiting to be claimed, and letting a stranger register `admin` before the
 * administrator does would hand them the role the grant was written for.
 */
async function handleAvailable(handle: string): Promise<RegisterRejection | null> {
  if (enrollmentPolicy.reservedHandles.some((r) => normalizeHandle(r) === handle)) {
    return "handle-reserved";
  }
  if (getGrant(handle)) return "handle-reserved";
  if (await getAccount(handle)) return "handle-taken";
  return null;
}

export async function register(input: {
  handle: string;
  displayName: string;
  email: string;
  password: string;
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

  const account = await createAccount({
    handle,
    displayName: input.displayName,
    email,
    source: "registration",
    // Verification is what makes the address trustworthy, and the address is
    // what decides the cohort — so without it the account may not act.
    status: enrollmentPolicy.requireEmailVerification ? "pending" : "active",
    emailVerifiedAt: enrollmentPolicy.requireEmailVerification
      ? null
      : new Date(),
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
  return { ok: true, handle, displayName: account.displayName, email };
}
