export interface MailBody {
  subject: string;
  text: string;
  html: string;
}

export interface VerificationCodeMail {
  code: string;
  expiresAt: Date;
}

export interface PasswordResetMail {
  displayName: string;
  url: string;
  expiresAt: Date;
}

export interface EmailTemplates {
  verificationCode(input: VerificationCodeMail): MailBody;
  resetPassword(input: PasswordResetMail): MailBody;
}
