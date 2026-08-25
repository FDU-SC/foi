/**
 * One rendered message, minus who it goes to.
 *
 * The split is what makes copy a template: a deployment decides the words, the
 * kernel decides the envelope and the address. `MailMessage` in `./transport`
 * is this plus `to`.
 */
export interface MailBody {
  subject: string;
  text: string;
  html: string;
}

/**
 * Addressed to nobody by name, because this goes out before the account does —
 * there is an address somebody has claimed and nothing else to greet.
 */
export interface VerificationCodeMail {
  code: string;
  expiresAt: Date;
}

export interface PasswordResetMail {
  displayName: string;
  url: string;
  expiresAt: Date;
}

/**
 * The messages the kernel sends, as a contract a deployment fills in.
 *
 * Which messages exist is the kernel's: registration verifies an address and
 * recovery mints a link, and both are flows this codebase implements. What
 * they *say* is not — a school competition and a public CTF want different
 * words for the same event — so the copy is discovered from `content/emails/`
 * the way problems and rulesets are, and a deployment that ships none gets the
 * plain fallback in `./registry`.
 *
 * The two are separate methods rather than one keyed by an event name so that
 * a template file failing to cover one of them is a type error rather than a
 * message that silently arrives blank.
 */
export interface EmailTemplates {
  verificationCode(input: VerificationCodeMail): MailBody;
  resetPassword(input: PasswordResetMail): MailBody;
}
