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

export function domainAllowed(email: string): boolean {
  const allowed = enrollmentPolicy.emailDomains;
  if (allowed.length === 0) return true;

  const domain = email.slice(email.lastIndexOf("@") + 1);

  return allowed.some(
    (candidate) =>
      domain === candidate.toLowerCase() ||
      domain.endsWith(`.${candidate.toLowerCase()}`),
  );
}

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

  const verified = await isEmailVerified(email);
  if (!verified || !checkRegistrationProof(email, input.proof)) {
    return { ok: false, reason: "email-unverified" };
  }

  return db.transaction<RegisterResult>(async (tx) => {
    const account = await createAccount(
      {
        handle,
        displayName: input.displayName,
        email,
        status: "active",
      },
      tx,
    );

    if (!account) {
      return {
        ok: false,
        reason: (await findAccountByEmail(email, tx))
          ? "email-taken"
          : "handle-taken",
      };
    }

    await setPassword(handle, input.password, tx);

    await consumeVerifiedEmail(email, tx);

    return { ok: true, handle, displayName: account.displayName, email };
  });
}
