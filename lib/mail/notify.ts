import { resetPassword, setupCode, verifyEmail } from "@/content/emails";
import { issueToken, lastIssuedAt } from "@/lib/auth/tokens";
import type { TokenPurpose } from "@/lib/db/schema";
import { deliver } from "./transport";

/**
 * The three things FOI mails, each of which is "mint a token, put it in a
 * link, send it".
 *
 * Throttling lives here rather than in a rate-limit store because the token
 * table already records when the last one went out. That answer survives a
 * restart and is the same in every process, neither of which is true of an
 * in-memory counter — and the thing being limited is precisely the thing being
 * recorded.
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

export async function sendVerification(to: Recipient): Promise<NotifyResult> {
  const wait = await throttled(to.handle, "email_verify");
  if (wait > 0) return { ok: false, reason: "throttled", retryAfterMs: wait };

  const { token, expiresAt } = await issueToken(to.handle, "email_verify");
  await deliver({
    to: to.email,
    ...verifyEmail({
      displayName: to.displayName,
      url: linkTo("/verify", token),
      expiresAt,
    }),
  });

  return { ok: true, expiresAt };
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

/**
 * Mails an administrator-issued setup code, for the case where the account has
 * an address. When it does not — the bootstrap administrator — the console
 * shows the code instead and somebody hands it over out of band.
 */
export async function sendSetupCode(
  to: Recipient,
  token: string,
  expiresAt: Date,
): Promise<void> {
  await deliver({
    to: to.email,
    ...setupCode({
      displayName: to.displayName,
      url: linkTo("/setup", token),
      expiresAt,
    }),
  });
}
