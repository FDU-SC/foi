import { escapeHtml } from "@/lib/mail/html";
import type { MailBody } from "@/lib/mail/types";
import { site } from "@/lib/site";

export type { MailBody };

export interface ActionMail {
  subject: string;

  intro: string[];
  action: { label: string; url: string };
  expiresAt: Date;

  footnote?: string[];
}

export interface NoticeMail {
  subject: string;

  intro: string[];

  /** Rendered as an inline link, not a button — a notice should not train users to click through. */
  link?: { label: string; url: string };

  footnote?: string[];
}

export interface CodeMail {
  subject: string;

  intro: string[];

  code: string;
  expiresAt: Date;

  footnote?: string[];
}

const formatter = new Intl.DateTimeFormat(site.lang, {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: site.timezone,
});

function paragraph(line: string): string {
  return `    <p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:#374151;">${escapeHtml(line)}</p>`;
}

function note(line: string, first = false): string {
  return `    <p style="margin:${first ? "0" : "12px"} 0 0;font-size:12px;line-height:1.7;color:#6b7280;">${escapeHtml(line)}</p>`;
}

function shell(inner: string): string {
  return `<!doctype html>
<html lang="${site.lang}">
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'PingFang SC','Microsoft YaHei',sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
    <div style="font-size:20px;font-weight:700;letter-spacing:-0.01em;color:#111827;margin-bottom:24px;">${escapeHtml(site.name)}</div>
${inner}
  </div>
</body>
</html>`;
}

export function actionMail(mail: ActionMail): MailBody {
  const expiry = `此链接在 ${formatter.format(mail.expiresAt)} 前有效，只能使用一次。`;
  const footnote = mail.footnote ?? [];

  const text = [
    ...mail.intro,
    "",
    mail.action.url,
    "",
    expiry,
    ...footnote,
    "",
    `— ${site.name}`,
  ].join("\n");

  const html = shell(
    [
      ...mail.intro.map((line) => paragraph(line)),
      `    <p style="margin:24px 0;">
      <a href="${escapeHtml(mail.action.url)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 20px;border-radius:8px;">${escapeHtml(mail.action.label)}</a>
    </p>`,
      `    <p style="margin:0 0 12px;font-size:12px;line-height:1.7;color:#6b7280;">
      按钮打不开时，请复制以下地址到浏览器：<br />
      <span style="word-break:break-all;color:#374151;">${escapeHtml(mail.action.url)}</span>
    </p>`,
      note(expiry, true),
      ...footnote.map((line) => note(line)),
    ].join("\n"),
  );

  return { subject: mail.subject, text, html };
}

export function formatMoment(at: Date): string {
  return formatter.format(at);
}

export function noticeMail(mail: NoticeMail): MailBody {
  const footnote = mail.footnote ?? [];

  const text = [
    ...mail.intro,
    ...(mail.link ? ["", `${mail.link.label}：${mail.link.url}`] : []),
    "",
    ...footnote,
    "",
    `— ${site.name}`,
  ].join("\n");

  const html = shell(
    [
      ...mail.intro.map((line) => paragraph(line)),
      ...(mail.link
        ? [
            `    <p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:#374151;">
      <a href="${escapeHtml(mail.link.url)}" style="color:#111827;">${escapeHtml(mail.link.label)}</a>
    </p>`,
          ]
        : []),
      ...footnote.map((line, index) => note(line, index === 0)),
    ].join("\n"),
  );

  return { subject: mail.subject, text, html };
}

export function codeMail(mail: CodeMail): MailBody {
  const expiry = `验证码在 ${formatter.format(mail.expiresAt)} 前有效。`;
  const footnote = mail.footnote ?? [];

  const text = [
    ...mail.intro,
    "",
    mail.code,
    "",
    expiry,
    ...footnote,
    "",
    `— ${site.name}`,
  ].join("\n");

  const html = shell(
    [
      ...mail.intro.map((line) => paragraph(line)),
      `    <p style="margin:24px 0;text-align:center;">
      <span style="display:inline-block;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;padding:14px 24px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:28px;font-weight:700;letter-spacing:0.3em;text-indent:0.3em;color:#111827;">${escapeHtml(mail.code)}</span>
    </p>`,
      note(expiry, true),
      ...footnote.map((line) => note(line)),
    ].join("\n"),
  );

  return { subject: mail.subject, text, html };
}
