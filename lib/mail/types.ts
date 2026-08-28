export interface MailBody {
  subject: string;
  text: string;
  html: string;
}

export interface VerificationLinkMail {
  url: string;
  expiresAt: Date;
}

export interface PasswordResetMail {
  displayName: string;
  url: string;
  expiresAt: Date;
}

export interface EmailChangeMail {
  displayName: string;
  newEmail: string;
  url: string;
  expiresAt: Date;
}

export type SecurityChangeKind = "password" | "username";

export interface SecurityNoticeMail {
  displayName: string;
  kind: SecurityChangeKind;
  changedAt: Date;

  detail?: string;

  recoverUrl: string;
}

export interface EmailTemplates {
  verificationLink(input: VerificationLinkMail): MailBody;
  resetPassword(input: PasswordResetMail): MailBody;
  emailChange(input: EmailChangeMail): MailBody;
  securityNotice(input: SecurityNoticeMail): MailBody;
}
