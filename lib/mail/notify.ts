import { issueCode } from "@/lib/enrollment/email-verification";
import { issueToken, lastIssuedAt, revokeTokens } from "@/lib/accounts/tokens";
import { emailTemplates } from "./registry";
import { deliver } from "./transport";

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

async function throttled(handle: string): Promise<number> {
  const last = await lastIssuedAt(handle);
  if (!last) return 0;

  const elapsed = Date.now() - last.getTime();
  return elapsed >= RESEND_COOLDOWN_MS ? 0 : RESEND_COOLDOWN_MS - elapsed;
}

export interface Recipient {
  handle: string;
  displayName: string;
  email: string;
}

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

export async function sendPasswordReset(to: Recipient): Promise<NotifyResult> {
  const wait = await throttled(to.handle);
  if (wait > 0) return { ok: false, reason: "throttled", retryAfterMs: wait };

  const { token, expiresAt, id } = await issueToken(to.handle, {
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

  try {
    await revokeTokens(to.handle, { exceptId: id });
  } catch (error) {
    console.error(
      `[foi] 重置链接已发出，但作废 ${to.handle} 的旧链接失败`,
      error,
    );
  }

  return { ok: true, expiresAt };
}
