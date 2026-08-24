/**
 * The shared shape of every message FOI sends.
 *
 * Same idea as `mdx-components.tsx`: a single place that decides what these
 * look like, so a new template is a few lines of copy rather than a fresh
 * attempt at HTML email. Everything is inline-styled and table-free, because
 * mail clients strip stylesheets and disagree about everything else.
 */
export interface MailBody {
  subject: string;
  text: string;
  html: string;
}

export interface ActionMail {
  subject: string;
  /** Shown above the button. One or two sentences. */
  intro: string[];
  action: { label: string; url: string };
  expiresAt: Date;
  /** Shown in smaller type under the button. */
  footnote?: string[];
}

export interface CodeMail {
  subject: string;
  /** Shown above the code. One or two sentences. */
  intro: string[];
  /** Digits only. Displayed as-is, so it must already be what gets typed. */
  code: string;
  expiresAt: Date;
  /** Shown in smaller type under the code. */
  footnote?: string[];
}

const formatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Asia/Shanghai",
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraph(line: string): string {
  return `    <p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:#374151;">${escapeHtml(line)}</p>`;
}

function note(line: string, first = false): string {
  return `    <p style="margin:${first ? "0" : "12px"} 0 0;font-size:12px;line-height:1.7;color:#6b7280;">${escapeHtml(line)}</p>`;
}

/** The card every message sits in. Only the middle differs between templates. */
function shell(inner: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'PingFang SC','Microsoft YaHei',sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
    <div style="font-size:20px;font-weight:700;letter-spacing:-0.01em;color:#111827;margin-bottom:24px;">FOI</div>
${inner}
  </div>
</body>
</html>`;
}

/**
 * The link is repeated as plain text under the button on purpose. Plenty of
 * clients refuse to render the anchor, and a verification email whose link
 * cannot be reached is a person who cannot finish signing up.
 */
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
    "— FOI",
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

/**
 * A code instead of a link, for the one thing that happens before an account
 * exists. There is nothing to link to: the person is already on the page that
 * needs the answer, and sending them away from a half-filled form to come back
 * through a second tab is worse than asking them to type six digits.
 *
 * `text-indent` cancels the trailing space `letter-spacing` leaves after the
 * last digit, which is the difference between the code looking centred and
 * looking slightly off.
 */
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
    "— FOI",
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
