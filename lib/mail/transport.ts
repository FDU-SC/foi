import { createTransport, type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

/**
 * Handing a message to the mail server, and nothing more.
 *
 * There is no outbox table and no retry loop here, for the same reason the
 * kernel does not queue submissions: an SMTP relay is already a queue with
 * retries and a bounce policy, and putting a second one in front of it makes
 * the two fight over backpressure while splitting the delivery record across
 * two systems. FOI hands the message over once and reports what happened.
 *
 * With no host configured, mail goes to stdout instead. A fresh checkout
 * should be able to run the whole registration flow without a mail server
 * standing by, which is the same bargain `scripts/mock-backend.ts` offers for
 * judging — and printing the link is what makes it usable.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

declare global {
  var __foiMailTransport: Transporter | undefined;
}

function readFrom(): string {
  return process.env.FOI_MAIL_FROM || "FOI <foi@localhost>";
}

/**
 * Whether this deployment has excused its relay from encrypting.
 *
 * An opt-out rather than an opt-in, so a deployment that never heard of this
 * variable gets the safe posture. What it is for is the local Mailpit, which
 * speaks no STARTTLS at all: without an escape hatch, requiring the upgrade
 * would turn the one mail setup a fresh checkout is told to use into a
 * connection error.
 */
function relayMaySkipTls(): boolean {
  return process.env.FOI_SMTP_ALLOW_INSECURE === "true";
}

/**
 * What nodemailer is handed, or null when no relay is configured — which is
 * what selects the console sink.
 *
 * Split out from `buildTransporter` so the TLS posture can be asserted without
 * standing a transport up: nodemailer types a `Transporter`'s `.options` as
 * the *message* defaults, so what was passed in is not readable back off it.
 */
export function relayOptions(): SMTPTransport.Options | null {
  const host = process.env.FOI_SMTP_HOST;
  if (!host) return null;

  const user = process.env.FOI_SMTP_USER;
  const pass = process.env.FOI_SMTP_PASSWORD;

  // Implicit TLS, which is port 465 and nothing else.
  const secure = process.env.FOI_SMTP_SECURE === "true";

  return {
    host,
    port: Number(process.env.FOI_SMTP_PORT ?? 587),
    secure,
    // Left to itself, nodemailer upgrades only when the server advertises
    // STARTTLS — so anything on the path strips the advertisement and watches
    // a password reset link, a verification code and the relay's own password
    // go by in the clear, with the send reporting success either way. This
    // issues STARTTLS regardless of what was advertised and refuses to send if
    // the upgrade fails, which is the whole difference between opportunistic
    // and required.
    //
    // Left off under implicit TLS for the same reason nodemailer's own
    // condition is: on 465 the socket is encrypted from the first byte, so
    // there is no plaintext phase to protect and the flag is read and ignored.
    // Saying so here keeps the intent legible rather than resting on that.
    requireTLS: !secure && !relayMaySkipTls(),
    auth: user ? { user, pass } : undefined,
  };
}

function buildTransporter(): Transporter | null {
  const options = relayOptions();
  return options ? createTransport(options) : null;
}

function transporter(): Transporter | null {
  if (globalThis.__foiMailTransport) return globalThis.__foiMailTransport;

  const built = buildTransporter();
  if (built) globalThis.__foiMailTransport = built;
  return built;
}

export function mailIsConfigured(): boolean {
  return Boolean(process.env.FOI_SMTP_HOST);
}

/**
 * Throws when the relay refuses the message. Callers surface that to the
 * person waiting on the email rather than swallowing it — a registration that
 * silently sends nothing is worse than one that fails loudly and can be
 * retried.
 */
export async function deliver(message: MailMessage): Promise<void> {
  const from = readFrom();
  const smtp = transporter();

  if (!smtp) {
    console.log(
      [
        "",
        "──────── [foi] 未配置 SMTP，邮件打印到控制台 ────────",
        `From:    ${from}`,
        `To:      ${message.to}`,
        `Subject: ${message.subject}`,
        "",
        message.text,
        "────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return;
  }

  await smtp.sendMail({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
