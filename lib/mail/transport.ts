import { createTransport, type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { tier } from "@/lib/boot/deployment";
import { site } from "@/lib/site";
import type { MailBody } from "./types";

export type MailDelivery = "smtp" | "console";

export interface MailMessage extends MailBody {
  to: string;
}

declare global {
  var __foiMailTransport: Transporter | undefined;
}

function readFrom(): string {
  return process.env.FOI_MAIL_FROM || `${site.name} <noreply@localhost>`;
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

export function declaredDelivery(): MailDelivery {
  const explicit = process.env.FOI_MAIL_DELIVERY;
  if (explicit === "console" || explicit === "smtp") return explicit;
  return "smtp";
}

export function mailDeliveryComplaints(): string[] {
  if (declaredDelivery() !== "smtp") return [];
  if (relayOptions() !== null) return [];

  return [
    "FOI_MAIL_DELIVERY 是 smtp（默认），但 FOI_SMTP_HOST 没有设置。" +
      "请设置 FOI_SMTP_HOST（以及需要的 FOI_SMTP_PORT / FOI_SMTP_USER / FOI_SMTP_PASSWORD），" +
      '或者设置 FOI_MAIL_DELIVERY=console——后者会把验证码和重置链接打印到服务端日志，' +
      "只适合本地开发或还没有用户的首次部署。",
  ];
}

export function mailSink(): "smtp" | "console" {
  const delivery = declaredDelivery();
  if (delivery === "console") return "console";
  if (relayOptions() !== null) return "smtp";

  if (tier() === "prod") {
    throw new Error(
      "FOI_MAIL_DELIVERY 是 smtp（默认），但 FOI_SMTP_HOST 没有设置，" +
        "生产环境拒绝回落到控制台。",
    );
  }
  return "console";
}

export function mailDeliveryUnmet(): boolean {
  return declaredDelivery() === "smtp" && relayOptions() === null;
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
