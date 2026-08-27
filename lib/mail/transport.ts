import { createTransport, type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { tier } from "@/lib/boot/deployment";
import {
  enrollmentDeclared,
  enrollmentPolicy,
} from "@/lib/enrollment/registry";
import type { EnrollmentPolicy } from "@/lib/enrollment/types";
import type { MailBody } from "./types";

/**
 * Handing a message to the mail server, and nothing more.
 *
 * There is no outbox table and no retry loop here, for the same reason the
 * kernel does not queue submissions: an SMTP relay is already a queue with
 * retries and a bounce policy, and putting a second one in front of it makes
 * the two fight over backpressure while splitting the delivery record across
 * two systems. FOI hands the message over once and reports what happened.
 *
 * Mail may also go to stdout instead, and which of the two happens must be a
 * declared decision rather than a side effect of the environment — see
 * `policy.mailDelivery` in `lib/enrollment/types.ts`. A fresh checkout runs the
 * whole registration flow with no mail server standing by; a production box
 * has to say it means that.
 */
export interface MailMessage extends MailBody {
  to: string;
}

declare global {
  var __foiMailTransport: Transporter | undefined;
}

function readFrom(): string {
  return process.env.FOI_MAIL_FROM || "FOI <foi@localhost>";
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
    //
    // No opt-out. There used to be one, for a local Mailpit that speaks no
    // STARTTLS, and it is gone along with Mailpit itself: a deployment with no
    // relay now gets the console sink outside prod, which is a better answer to
    // "I want to see the mail locally" than a variable whose only other use is
    // to send reset links in the clear.
    requireTLS: !secure,
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

type MailDelivery = EnrollmentPolicy["mailDelivery"];

const COMPLAINT =
  "邮件投递配置不完整，拒绝启动:\n" +
  '  注册策略声明了 mailDelivery: "smtp"，但没有设置 FOI_SMTP_HOST。\n' +
  "  请设置 FOI_SMTP_HOST（以及需要的 FOI_SMTP_PORT / FOI_SMTP_USER / FOI_SMTP_PASSWORD），\n" +
  '  或者在 content/enrollment/ 的 policy 里显式写上 mailDelivery: "console"。\n' +
  "  后者会把验证码和重置链接打印到服务端日志，只适合本地开发，" +
  "或者还没有用户的首次部署。";

const UNDECLARED_COMPLAINT =
  "没有找到 content/enrollment/，注册策略全部取的是内核默认值，" +
  'mailDelivery 因此是 "smtp"，而 FOI_SMTP_HOST 没有设置——' +
  "验证码与重置链接都发不出去。这套部署一旦要接待用户，" +
  "就该补一个 content/enrollment/，在它的 policy 里把这件事说清楚。";

/**
 * A deployment that says it sends mail and has nothing to send it with.
 *
 * Refused in prod and said elsewhere, and which of those happens is
 * `lib/boot/checks.ts`'s decision rather than this module's. What is worth
 * refusing over is a deployment whose registration and recovery are dead ends
 * saying so while the health check is still watching, rather than at the first
 * person who cannot get their verification code.
 *
 * Only for a deployment that shipped enrolment content. The refusal rests on
 * `smtp` being what somebody *chose*, whether by writing it or by writing a
 * policy and leaving the default in place; with no `content/enrollment/` the
 * value came from `enrollmentPolicySchema`, which is to say from the kernel.
 * Refusing there would refuse over a decision the platform made on the
 * deployment's behalf, and would stop an empty `content/` from starting at all
 * — see the `check-baseline` job. That half is
 * `defaultedMailDeliveryComplaints` below, which nothing ever refuses over.
 *
 * Both inputs are parameters defaulting to the registry, the way `assertEnv`
 * takes `process.env`: what is being checked is a *combination* of a declared
 * delivery and an environment, and a test cannot edit `content/enrollment/`
 * to reach one half of it.
 */
export function mailDeliveryComplaints(
  delivery: MailDelivery = enrollmentPolicy.mailDelivery,
  declared: boolean = enrollmentDeclared,
): string[] {
  if (!declared || !mailDeliveryUnmet(delivery)) return [];
  return [COMPLAINT];
}

/** The same gap, on a deployment that declared no enrolment rules at all. */
export function defaultedMailDeliveryComplaints(
  delivery: MailDelivery = enrollmentPolicy.mailDelivery,
  declared: boolean = enrollmentDeclared,
): string[] {
  if (declared || !mailDeliveryUnmet(delivery)) return [];
  return [UNDECLARED_COMPLAINT];
}

/**
 * Which of the two sinks a message goes to.
 *
 * The console branch is reached by declaring it, not by leaving a variable
 * unset — that is the whole point of `policy.mailDelivery`. The one exception
 * is the development fallback, which keeps a checkout with no relay working.
 */
export function mailSink(
  delivery: MailDelivery = enrollmentPolicy.mailDelivery,
): "smtp" | "console" {
  if (delivery === "console") return "console";
  if (relayOptions() !== null) return "smtp";

  // Declared `smtp` with nothing behind it. On prod the boot check has already
  // refused this, so arriving here means the process was started some other
  // way — throw rather than print a reset link to the log, which is the failure
  // the pair of them exists to stop.
  //
  // Keyed on the tier and not on `NODE_ENV`, which is the whole point of the
  // distinction: the image pins `NODE_ENV=production` for staging too, so on
  // `NODE_ENV` a staging deployment could not fall back to the console no
  // matter what it declared.
  if (tier() === "prod") throw new Error(COMPLAINT);
  return "console";
}

/**
 * The disagreement itself: this deployment says it sends mail and has nothing
 * to send it with.
 *
 * The bare predicate the two complaint functions above are worded from and
 * `mailSink` refuses to answer for, asked by something that only wants to
 * report it. Those refusals are right where they are — a caller one line away
 * from printing a reset link should not be handed a quiet fallback — and both
 * are wrong for the operations console, whose entire job is to name drift like
 * this and which cannot do it from a page that throws instead of rendering.
 *
 * Takes the delivery for the reason the complaints do: what is being checked is
 * a *combination* of a declared delivery and an environment, and a test cannot
 * edit `content/enrollment/` to reach one half of it.
 */
export function mailDeliveryUnmet(
  delivery: MailDelivery = enrollmentPolicy.mailDelivery,
): boolean {
  return delivery === "smtp" && relayOptions() === null;
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
