import { createTransport, type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { tier } from "@/lib/boot/deployment";
import { log } from "@/lib/log";
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
    "FOI_MAIL_DELIVERY 是 smtp，但 FOI_SMTP_HOST 未设置。",
  ];
}

export function mailSink(): "smtp" | "console" {
  const delivery = declaredDelivery();
  if (delivery === "console") return "console";
  if (relayOptions() !== null) return "smtp";

  if (tier() === "prod") {
    throw new Error(
      "FOI_MAIL_DELIVERY 是 smtp，但 FOI_SMTP_HOST 未设置。",
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
    log.info(
      [
        "──────── 邮件打印到控制台，未实际投递 ────────",
        `From:    ${from}`,
        `To:      ${message.to}`,
        `Subject: ${message.subject}`,
        "",
        message.text,
        "────────────────────────────────────────────────────",
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
