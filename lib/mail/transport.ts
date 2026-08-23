import { createTransport, type Transporter } from "nodemailer";

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
 * standing by, which is the same bargain `scripts/mock-judge.ts` offers for
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

/** Null when no SMTP host is configured, which selects the console sink. */
function buildTransporter(): Transporter | null {
  const host = process.env.FOI_SMTP_HOST;
  if (!host) return null;

  const user = process.env.FOI_SMTP_USER;
  const pass = process.env.FOI_SMTP_PASSWORD;

  return createTransport({
    host,
    port: Number(process.env.FOI_SMTP_PORT ?? 587),
    // Implicit TLS, which is port 465 and nothing else. On any other port this
    // stays false and the connection is still upgraded via STARTTLS when the
    // server offers it.
    secure: process.env.FOI_SMTP_SECURE === "true",
    auth: user ? { user, pass } : undefined,
  });
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
