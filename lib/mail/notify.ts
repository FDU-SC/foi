import { issueToken } from "@/lib/tokens/stateless";
import { emailTemplates } from "./registry";
import { deliver } from "./transport";

const VERIFY_TTL_MS = 30 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const EMAIL_CHANGE_TTL_MS = 30 * 60 * 1000;

function linkTo(path: string, token: string): string {
  const base = process.env.FOI_PUBLIC_URL;
  if (!base) throw new Error("缺少环境变量 FOI_PUBLIC_URL");

  const url = new URL(path, base);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function sendVerificationLink(email: string): Promise<void> {
  const token = issueToken({
    purpose: "email-verify",
    subject: email,
    ttlMs: VERIFY_TTL_MS,
  });

  const expiresAt = new Date(Date.now() + VERIFY_TTL_MS);

  await deliver({
    to: email,
    ...emailTemplates.verificationLink({
      url: linkTo("/register", token),
      expiresAt,
    }),
  });
}

export interface Recipient {
  handle: string;
  displayName: string;
  email: string;
}

export async function sendPasswordReset(
  to: Recipient,
  passwordFingerprint: string,
): Promise<void> {
  const token = issueToken({
    purpose: "password-reset",
    subject: to.handle,
    fingerprint: passwordFingerprint,
    ttlMs: RESET_TTL_MS,
  });

  const expiresAt = new Date(Date.now() + RESET_TTL_MS);

  await deliver({
    to: to.email,
    ...emailTemplates.resetPassword({
      displayName: to.displayName,
      url: linkTo("/reset-password", token),
      expiresAt,
    }),
  });
}

export async function sendEmailChangeLink(
  to: Recipient,
  newEmail: string,
  emailFingerprint: string,
): Promise<void> {
  const token = issueToken({
    purpose: "email-change",
    subject: to.handle,
    data: { newEmail },
    fingerprint: emailFingerprint,
    ttlMs: EMAIL_CHANGE_TTL_MS,
  });

  const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TTL_MS);

  await deliver({
    to: newEmail,
    ...emailTemplates.emailChange({
      displayName: to.displayName,
      newEmail,
      url: linkTo("/settings/email/confirm", token),
      expiresAt,
    }),
  });
}
