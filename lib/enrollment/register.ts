import {
  createAccount,
  findAccountByEmail,
  getAccountByUsername,
} from "@/lib/accounts/queries";
import { setPassword } from "@/lib/accounts/password";
import { normalizeEmail } from "@/lib/accounts/types";
import { allows } from "@/lib/authz/engine";
import { ANONYMOUS } from "@/lib/authz/viewer";
import { db } from "@/lib/db";
import { verifyToken } from "@/lib/tokens/stateless";
import { enrollmentPolicy } from "./registry";

export type RegisterRejection =
  | "closed"
  | "username-taken"
  | "email-domain"
  | "email-taken"
  | "email-unverified";

/** Registration happens without a session, so the policy is asked as nobody. */
export function registrationOpen(): boolean {
  return allows("account.register", null, ANONYMOUS);
}

export type RegisterResult =
  | { ok: true; uid: number; username: string; nickname: string; email: string }
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

async function usernameAvailable(username: string): Promise<RegisterRejection | null> {
  if (await getAccountByUsername(username)) return "username-taken";
  return null;
}

export async function register(input: {
  username: string;
  nickname: string;
  email: string;
  password: string;
  token: string;
}): Promise<RegisterResult> {
  if (!registrationOpen()) return { ok: false, reason: "closed" };

  const email = normalizeEmail(input.email, {
    stripSubaddress: enrollmentPolicy.stripSubaddress,
  });

  const payload = verifyToken(input.token, "email-verify");
  if (!payload || payload.s !== email) {
    return { ok: false, reason: "email-unverified" };
  }

  const unavailable = await usernameAvailable(input.username);
  if (unavailable) return { ok: false, reason: unavailable };

  if (!domainAllowed(email)) return { ok: false, reason: "email-domain" };
  if (await findAccountByEmail(email)) return { ok: false, reason: "email-taken" };

  return db.transaction<RegisterResult>(async (tx) => {
    const account = await createAccount(
      {
        username: input.username,
        nickname: input.nickname,
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
          : "username-taken",
      };
    }

    await setPassword(account.uid, input.password, tx);

    return {
      ok: true,
      uid: account.uid,
      username: account.username,
      nickname: account.nickname,
      email,
    };
  });
}
