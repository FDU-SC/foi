import { createTransport, type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { tier } from "@/lib/boot/deployment";
import {
  enrollmentDeclared,
  enrollmentPolicy,
} from "@/lib/enrollment/registry";
import type { EnrollmentPolicy } from "@/lib/enrollment/types";
import type { MailBody } from "./types";

export interface MailMessage extends MailBody {
  to: string;
}

declare global {
  var __foiMailTransport: Transporter | undefined;
}

function readFrom(): string {
  return process.env.FOI_MAIL_FROM || "FOI <foi@localhost>";
}

export function relayOptions(): SMTPTransport.Options | null {
  const host = process.env.FOI_SMTP_HOST;
  if (!host) return null;

  const user = process.env.FOI_SMTP_USER;
  const pass = process.env.FOI_SMTP_PASSWORD;

  const secure = process.env.FOI_SMTP_SECURE === "true";

  return {
    host,
    port: Number(process.env.FOI_SMTP_PORT ?? 587),
    secure,

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

export function mailDeliveryComplaints(
  delivery: MailDelivery = enrollmentPolicy.mailDelivery,
  declared: boolean = enrollmentDeclared,
): string[] {
  if (!declared || !mailDeliveryUnmet(delivery)) return [];
  return [COMPLAINT];
}

export function defaultedMailDeliveryComplaints(
  delivery: MailDelivery = enrollmentPolicy.mailDelivery,
  declared: boolean = enrollmentDeclared,
): string[] {
  if (declared || !mailDeliveryUnmet(delivery)) return [];
  return [UNDECLARED_COMPLAINT];
}

export function mailSink(
  delivery: MailDelivery = enrollmentPolicy.mailDelivery,
): "smtp" | "console" {
  if (delivery === "console") return "console";
  if (relayOptions() !== null) return "smtp";

  if (tier() === "prod") throw new Error(COMPLAINT);
  return "console";
}

export function mailDeliveryUnmet(
  delivery: MailDelivery = enrollmentPolicy.mailDelivery,
): boolean {
  return delivery === "smtp" && relayOptions() === null;
}

export async function deliver(message: MailMessage): Promise<void> {
  const from = readFrom();

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
