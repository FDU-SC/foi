import { issueToken } from "@/lib/tokens/stateless";
import { emailTemplates } from "./registry";
import { deliver } from "./transport";
import type { SecurityChangeKind } from "./types";

const VERIFY_TTL_MS = 30 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const EMAIL_CHANGE_TTL_MS = 30 * 60 * 1000;

function urlTo(path: string): URL {
  const base = process.env.FOI_PUBLIC_URL;
  if (!base) throw new Error("缺少环境变量 FOI_PUBLIC_URL");

  return new URL(path, base);
}

function linkTo(path: string, token: string): string {
  const url = urlTo(path);
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
  uid: number;
  nickname: string;
  email: string;
}

export async function sendPasswordReset(
  to: Recipient,
  passwordFingerprint: string,
): Promise<void> {
  const token = issueToken({
    purpose: "password-reset",
    subject: String(to.uid),
    fingerprint: passwordFingerprint,
    ttlMs: RESET_TTL_MS,
  });

  const expiresAt = new Date(Date.now() + RESET_TTL_MS);

  await deliver({
    to: to.email,
    ...emailTemplates.resetPassword({
      displayName: to.nickname,
      url: linkTo("/reset-password", token),
      expiresAt,
    }),
  });
}

export async function sendSecurityNotice(
  to: Recipient,
  kind: SecurityChangeKind,
  detail?: string,
): Promise<void> {
  await deliver({
    to: to.email,
    ...emailTemplates.securityNotice({
      displayName: to.nickname,
      kind,
      changedAt: new Date(),
      detail,
      recoverUrl: urlTo("/forgot-password").toString(),
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
    subject: String(to.uid),
    data: { newEmail },
    fingerprint: emailFingerprint,
    ttlMs: EMAIL_CHANGE_TTL_MS,
  });

  const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TTL_MS);

  await deliver({
    to: newEmail,
    ...emailTemplates.emailChange({
      displayName: to.nickname,
      newEmail,
      url: linkTo("/settings/email/confirm", token),
      expiresAt,
    }),
  });
}
