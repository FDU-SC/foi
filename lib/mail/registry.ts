import { emailModules } from "@/content/email-modules";
import { loadSingletonModule } from "@/lib/singleton-module";
import { escapeHtml } from "./html";
import type {
  EmailTemplates,
  MailBody,
  PasswordResetMail,
  VerificationCodeMail,
} from "./types";

/**
 * The copy for the two messages the kernel sends, discovered the same way
 * problems and rulesets are.
 *
 * Unlike those, this one has a fallback rather than an empty registry. A
 * deployment with no problems is a deployment with nothing to do; a deployment
 * with no mail copy still has to be able to let somebody back into their
 * account, and refusing to boot over the wording would be a worse failure than
 * sending plain words. The fallback is therefore deliberately plain — it is a
 * floor, not a default worth keeping — and startup says so.
 */

/**
 * Where the fallback's timestamps are read from, when a deployment says.
 *
 * No zone is written in here: naming one puts a single competition's wall
 * clock inside the platform, and a deployment elsewhere would then be telling
 * its users an expiry time in a city they do not live in, with no way out but
 * to stop using the fallback. `FOI_TIMEZONE` names an IANA zone; unset falls
 * through to whatever the process runs on.
 *
 * Built per call rather than once at module load, because the variable is read
 * at boot and a formatter cached above it would be pinned to whatever the
 * environment looked like when this module was first imported. Two mails a
 * minute is not a rate worth caching against.
 */
function formatExpiry(at: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: process.env.FOI_TIMEZONE || undefined,
  }).format(at);
}

/**
 * Every line as its own paragraph, and no styling at all. Whatever a
 * deployment ships will look better than this, which is the point: the
 * fallback should not be comfortable enough to leave in place.
 */
function plain(subject: string, lines: string[]): MailBody {
  const text = lines.join("\n");
  const html = lines
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("\n");
  return { subject, text, html };
}

const FALLBACK: EmailTemplates = {
  verificationCode(input: VerificationCodeMail): MailBody {
    return plain("验证你的注册邮箱", [
      "有人正在用这个邮箱注册账号。请回到注册页面填入下面的验证码。",
      input.code,
      `验证码在 ${formatExpiry(input.expiresAt)} 前有效。`,
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
};

const METHODS = ["verificationCode", "resetPassword"] as const;

function buildRegistry(): { templates: EmailTemplates; source: string | null } {
  const found = loadSingletonModule(emailModules, "邮件文案");
  if (!found) return { templates: FALLBACK, source: null };

  // Its own check rather than `requiredExport`, because there are two of them
  // and both have to be callable. The failure this catches is silent: a module
  // that exports one of the two leaves the other `undefined`, and nothing
  // notices until somebody asks for a reset link and gets a crash inside
  // `deliver`.
  const missing = METHODS.filter(
    (name) => typeof found.exports[name] !== "function",
  );
  if (missing.length > 0) {
    throw new Error(
      `${found.path} 必须导出 ${missing.join(" 与 ")}，见 lib/mail/types.ts 的 EmailTemplates`,
    );
  }

  return {
    templates: found.exports as unknown as EmailTemplates,
    source: found.path,
  };
}

const registry = buildRegistry();

export const emailTemplates: EmailTemplates = registry.templates;

/** Said at startup, alongside the other "legal but probably not meant" checks. */
export function mailTemplateWarnings(): string[] {
  if (registry.source) return [];
  return [
    "没有找到邮件文案，验证码和重置链接会以内置的纯文本样式发出。" +
      "补一个 content/emails/index.ts，导出 verificationCode 与 resetPassword。",
  ];
}
