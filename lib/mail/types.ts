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

export interface EmailTemplates {
  verificationLink(input: VerificationLinkMail): MailBody;
  resetPassword(input: PasswordResetMail): MailBody;
  emailChange(input: EmailChangeMail): MailBody;
}
