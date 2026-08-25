import { createTransport, type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { enrollmentPolicy } from "@/lib/enrollment/registry";
import type { EnrollmentPolicy } from "@/lib/enrollment/types";

/**
 * Handing a message to the mail server, and nothing more.
 *
 * There is no outbox table and no retry loop here, for the same reason the
 * kernel does not queue submissions: an SMTP relay is already a queue with
 * retries and a bounce policy, and putting a second one in front of it makes
 * the two fight over backpressure while splitting the delivery record across
 * two systems. FOI hands the message over once and reports what happened.
 *
 * Mail may also go to stdout instead, and which of the two happens is a
 * declared decision rather than a side effect of the environment — see
 * `policy.mailDelivery` in `lib/enrollment/types.ts`. A fresh checkout should
 * be able to run the whole registration flow without a mail server standing
 * by, which is the same bargain `scripts/mock-backend.ts` offers for judging;
 * what changed is that a production box has to say it means that.
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

/**
 * Whether a relay is configured. Answers about the environment only — for
 * where mail actually ends up, which the policy also has a say in, ask
 * `mailSink`; for whether the two contradict each other, `mailDeliveryUnmet`.
 */
export function mailIsConfigured(): boolean {
  return Boolean(process.env.FOI_SMTP_HOST);
}

type MailDelivery = EnrollmentPolicy["mailDelivery"];

const COMPLAINT =
  "邮件投递配置不完整，拒绝启动:\n" +
  '  注册策略声明了 mailDelivery: "smtp"，但没有设置 FOI_SMTP_HOST。\n' +
  "  请设置 FOI_SMTP_HOST（以及需要的 FOI_SMTP_PORT / FOI_SMTP_USER / FOI_SMTP_PASSWORD），\n" +
  '  或者在 content/enrollment/ 的 policy 里显式写上 mailDelivery: "console"。\n' +
  "  后者会把验证码和重置链接打印到服务端日志，只适合本地开发，" +
  "或者还没有用户的首次部署。";

/**
 * Refuses to boot a deployment that says it sends mail but cannot.
 *
 * Called from `instrumentation.ts` right after `assertEnv`, and separate from
 * it for the reason `backendSecretWarnings` is separate: this reads content,
 * and `lib/env.ts` deliberately knows nothing about content. The timing is the
 * same argument though — a deployment whose registration and recovery are dead
 * ends should say so while the health check is still watching, not at the
 * first person who cannot get their verification code.
 *
 * Fatal only in production. `content/enrollment/example.ts` declares no
 * `mailDelivery` and so inherits `smtp`, which would make a fresh checkout
 * with no relay refuse to start — the exact setup the README tells a newcomer
 * to use. Elsewhere this is a warning and `deliver` falls back to the console.
 *
 * The delivery is a parameter defaulting to the policy, the way `assertEnv`
 * takes `process.env`: what is being checked is a *combination* of a declared
 * delivery and an environment, and a test cannot edit `content/enrollment/`
 * to reach one half of it.
 */
export function assertMailDelivery(
  delivery: MailDelivery = enrollmentPolicy.mailDelivery,
): void {
  if (delivery === "console" || mailIsConfigured()) return;

  if (process.env.NODE_ENV === "production") throw new Error(COMPLAINT);

  console.warn(
    "[foi] 未设置 FOI_SMTP_HOST，邮件只会打印到控制台。" +
      "同样的配置在生产环境会直接拒绝启动；" +
      '如果这套部署本就不发信，请在 content/enrollment/ 的 policy 里写 mailDelivery: "console"。',
  );
}

/**
 * Which of the two sinks a message goes to.
 *
 * The console branch is now reached by declaring it, not by leaving a variable
 * unset — that is the whole point of `policy.mailDelivery`. The one exception
 * is the development fallback, which keeps a checkout with no relay working.
 */
export function mailSink(
  delivery: MailDelivery = enrollmentPolicy.mailDelivery,
): "smtp" | "console" {
  if (delivery === "console") return "console";
  if (mailIsConfigured()) return "smtp";

  // Declared `smtp` with nothing behind it. `assertMailDelivery` has already
  // refused this boot in production, so arriving here means the process was
  // started some other way — throw rather than print a reset link to the log,
  // which is the failure the pair of them exists to stop.
  if (process.env.NODE_ENV === "production") throw new Error(COMPLAINT);
  return "console";
}

/**
 * The disagreement itself: this deployment says it sends mail and has nothing
 * to send it with.
 *
 * The same condition `assertMailDelivery` refuses to boot on and `mailSink`
 * refuses to answer for, asked by something that only wants to report it. Both
 * refusals are right where they are — a caller one line away from printing a
 * reset link should not be handed a quiet fallback — and both are wrong for
 * the operations console, whose entire job is to name drift like this and
 * which cannot do it from a page that throws instead of rendering.
 *
 * Takes the delivery for the reason `assertMailDelivery` does: what is being
 * checked is a *combination* of a declared delivery and an environment, and a
 * test cannot edit `content/enrollment/` to reach one half of it.
 */
export function mailDeliveryUnmet(
  delivery: MailDelivery = enrollmentPolicy.mailDelivery,
): boolean {
  return delivery === "smtp" && !mailIsConfigured();
}

/**
 * Throws when the relay refuses the message. Callers surface that to the
 * person waiting on the email rather than swallowing it — a registration that
 * silently sends nothing is worse than one that fails loudly and can be
 * retried.
 */
export async function deliver(message: MailMessage): Promise<void> {
  const from = readFrom();
  // The sink is asked first, because it is what may refuse: a deployment that
  // declared `smtp` with no relay behind it must not quietly get the console.
  const smtp = mailSink() === "smtp" ? transporter() : null;

  if (!smtp) {
    console.log(
      [
        "",
        "──────── [foi] 邮件打印到控制台，未实际投递 ────────",
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
