import { resetPassword, verificationCode } from "@/content/emails";
import { issueCode } from "@/lib/auth/email-verification";
import { issueToken, lastIssuedAt } from "@/lib/auth/tokens";
import type { TokenPurpose } from "@/lib/db/schema";
import { deliver } from "./transport";

/**
 * The two things FOI mails.
 *
 * They are no longer the same shape. Recovery is still "mint a token, put it
 * in a link, send it" against an account that exists. Verification happens
 * before the account does, so it carries a code the person types back into the
 * page they are already on, and its throttle lives in the row the code is
 * stored in rather than here.
 */
const RESEND_COOLDOWN_MS = 60_000;

export type NotifyResult =
  | { ok: true; expiresAt: Date }
  | { ok: false; reason: "throttled"; retryAfterMs: number };

function linkTo(path: string, token: string): string {
  const base = process.env.FOI_PUBLIC_URL;
  if (!base) throw new Error("缺少环境变量 FOI_PUBLIC_URL");

  const url = new URL(path, base);
  url.searchParams.set("token", token);
  return url.toString();
}

async function throttled(
  handle: string,
  purpose: TokenPurpose,
): Promise<number> {
  const last = await lastIssuedAt(handle, purpose);
  if (!last) return 0;

  const elapsed = Date.now() - last.getTime();
  return elapsed >= RESEND_COOLDOWN_MS ? 0 : RESEND_COOLDOWN_MS - elapsed;
}

export interface Recipient {
  handle: string;
  displayName: string;
  email: string;
}

/**
 * Takes an address rather than a `Recipient`, because at this point in
 * registration that is all there is: no handle, no display name, and no
 * account to hang either on.
 */
export async function sendVerificationCode(
  email: string,
): Promise<NotifyResult> {
  const issued = await issueCode(email);
  if (!issued.ok) return issued;

  await deliver({
    to: email,
    ...verificationCode({ code: issued.code, expiresAt: issued.expiresAt }),
  });

  return { ok: true, expiresAt: issued.expiresAt };
}

export async function sendPasswordReset(to: Recipient): Promise<NotifyResult> {
  const wait = await throttled(to.handle, "password_reset");
  if (wait > 0) return { ok: false, reason: "throttled", retryAfterMs: wait };

  const { token, expiresAt } = await issueToken(to.handle, "password_reset");
  await deliver({
    to: to.email,
    ...resetPassword({
      displayName: to.displayName,
      url: linkTo("/reset-password", token),
      expiresAt,
    }),
  });

  return { ok: true, expiresAt };
}
