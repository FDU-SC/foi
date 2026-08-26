import { issueCode } from "@/lib/auth/email-verification";
import { issueToken, lastIssuedAt, revokeTokens } from "@/lib/auth/tokens";
import type { TokenPurpose } from "@/lib/db/schema";
import { emailTemplates } from "./registry";
import { deliver } from "./transport";

/**
 * How soon one *account* may be sent another recovery link.
 *
 * The two things FOI mails are no longer the same shape. Recovery is still
 * "mint a token, put it in a link, send it" against an account that exists.
 * Verification happens before the account does, so it carries a code the
 * person types back into the page they are already on, and its throttle lives
 * in the row the code is stored in rather than here.
 *
 * `lib/auth/email-verification.ts` holds a constant of the same name and the
 * same value, and they are deliberately two policies rather than one that got
 * copied. This one is keyed by handle and purpose and derived from the last
 * row in `auth_tokens`, because a reset link is minted against an account that
 * already exists. That one is keyed by address and enforced as a condition on
 * an upsert, because before an account exists an address is the only thing
 * there is to count against. Different subject, different table, different
 * mechanism — folding them into one export would be a claim that this
 * deployment has a single resend policy, which is an assertion somebody would
 * have to own, not a duplicate somebody forgot to remove.
 */
const RESEND_COOLDOWN_MS = 60_000;

/**
 * What came of a send, in the one vocabulary both callers read.
 *
 * `ok: false` means *nothing left this process*: no token was minted, no code
 * was written, and the relay was never called. The two callers present that in
 * opposite ways — `/admin` tells the operator to wait a minute, while
 * `requestPasswordReset` answers with the same sentence it gives every other
 * outcome, so the public form cannot be used to test whether an account
 * exists. That uniform sentence is a decision about what to *disclose* and not
 * licence to drop the result: the server log is the one place throttled and
 * delivered are still allowed to differ, and an operator who cannot tell them
 * apart there cannot tell a broken relay from somebody asking twice.
 *
 * A relay that refuses the message is the third outcome and deliberately not a
 * variant here. It is not a state a caller can reason about, only report, and
 * making it one would invite the same silence: see `deliver`, which throws.
 */
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
    ...emailTemplates.verificationCode({
      code: issued.code,
      expiresAt: issued.expiresAt,
    }),
  });

  return { ok: true, expiresAt: issued.expiresAt };
}

/**
 * The order here is the whole point: mint, send, and only then retire the
 * older links.
 *
 * `issueToken` retires by default, and leaving it to do so means a relay that
 * refuses the message has already killed whatever link was in the person's
 * inbox. That is the worst moment to do it — the mail path being down is
 * exactly when the old link is the only one they have — and nothing sweeps the
 * state up: they are locked out until the relay comes back *and* the resend
 * cooldown lapses, with a link they can see and cannot use.
 */
export async function sendPasswordReset(to: Recipient): Promise<NotifyResult> {
  const wait = await throttled(to.handle, "password_reset");
  if (wait > 0) return { ok: false, reason: "throttled", retryAfterMs: wait };

  const { token, expiresAt, id } = await issueToken(to.handle, "password_reset", {
    revokePrior: false,
  });
  await deliver({
    to: to.email,
    ...emailTemplates.resetPassword({
      displayName: to.displayName,
      url: linkTo("/reset-password", token),
      expiresAt,
    }),
  });

  // The new link is really in the mail, so the old ones can go. Failing here
  // is not worth reporting a failed send for: the message went out, and what
  // it leaves behind is a second live link minted seconds ago for the same
  // proven mailbox — which `issueToken` already documents as tolerable, and is
  // in any case better than telling the person nothing was sent.
  try {
    await revokeTokens(to.handle, "password_reset", { exceptId: id });
  } catch (error) {
    console.error(
      `[foi] 重置链接已发出，但作废 ${to.handle} 的旧链接失败`,
      error,
    );
  }

  return { ok: true, expiresAt };
}
