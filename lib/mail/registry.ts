import { emailModules } from "@/content/_modules/emails";
import { loadSingletonModule } from "@/lib/singleton-module";
import { site } from "@/lib/site";
import { escapeHtml } from "./html";
import type {
  EmailChangeMail,
  EmailTemplates,
  MailBody,
  PasswordResetMail,
  VerificationLinkMail,
} from "./types";

function formatExpiry(at: Date): string {
  return new Intl.DateTimeFormat(site.lang, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: site.timezone,
  }).format(at);
}

function plain(subject: string, lines: string[]): MailBody {
  const text = lines.join("\n");
  const html = lines
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("\n");
  return { subject, text, html };
}

const FALLBACK: EmailTemplates = {
  verificationLink(input: VerificationLinkMail): MailBody {
    return plain("验证你的注册邮箱", [
      "有人正在用这个邮箱注册账号。请打开下面的链接完成验证。",
      input.url,
      `此链接在 ${formatExpiry(input.expiresAt)} 前有效。`,
      "如果不是你本人操作，忽略这封邮件即可。",
    ]);
  },
  resetPassword(input: PasswordResetMail): MailBody {
    return plain("重置你的密码", [
      `${input.displayName}，你好：`,
      "我们收到了重置密码的请求。打开下面的地址设置一个新密码。",
      input.url,
      `此链接在 ${formatExpiry(input.expiresAt)} 前有效，只能使用一次。`,
      "如果不是你本人操作，忽略这封邮件即可。",
    ]);
  },
  emailChange(input: EmailChangeMail): MailBody {
    return plain("确认更换邮箱", [
      `${input.displayName}，你好：`,
      `我们收到了将邮箱更换为 ${input.newEmail} 的请求。打开下面的地址确认更换。`,
      input.url,
      `此链接在 ${formatExpiry(input.expiresAt)} 前有效。`,
      "如果不是你本人操作，忽略这封邮件即可。",
    ]);
  },
};

const METHODS = ["verificationLink", "resetPassword", "emailChange"] as const;

function buildRegistry(): { templates: EmailTemplates; source: string | null } {
  const found = loadSingletonModule(emailModules, "邮件文案");
  if (!found) return { templates: FALLBACK, source: null };

  const missing = METHODS.filter(
    (name) => typeof found.exports[name] !== "function",
  );
  if (missing.length > 0) {
    throw new Error(
      `${found.path} 必须导出 ${missing.join("、")}，见 lib/mail/types.ts 的 EmailTemplates`,
    );
  }

  return {
    templates: found.exports as unknown as EmailTemplates,
    source: found.path,
  };
}

const registry = buildRegistry();

export const emailTemplates: EmailTemplates = registry.templates;

export function mailTemplateWarnings(): string[] {
  if (registry.source) return [];
  return [
    "没有找到邮件文案，验证链接和重置链接会以内置的纯文本样式发出。" +
      "补一个 content/emails/index.ts，导出 verificationLink、resetPassword 与 emailChange。",
  ];
}
