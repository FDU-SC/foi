import type {
  EmailTemplates,
  MailBody,
  PasswordResetMail,
  VerificationCodeMail,
} from "@/lib/mail/types";

/**
 * The copy for the two messages the kernel sends, as plainly as the contract
 * allows.
 *
 * `lib/mail/registry.ts` has a fallback for a deployment that ships none, so
 * this file is not strictly required — it is here because the contract having
 * two named methods and both being checked at load is worth exercising.
 */
function plain(subject: string, lines: string[]): MailBody {
  return {
    subject,
    text: lines.join("\n"),
    html: lines.map((line) => `<p>${line}</p>`).join("\n"),
  };
}

export function verificationCode(input: VerificationCodeMail): MailBody {
  return plain("验证你的注册邮箱", [
    "有人正在用这个邮箱注册账号。请回到注册页面填入下面的验证码。",
    input.code,
    `验证码在 ${input.expiresAt.toISOString()} 之前有效。`,
  ]);
}

export function resetPassword(input: PasswordResetMail): MailBody {
  return plain("重置你的密码", [
    `${input.displayName}，你好：`,
    "打开下面的地址设置一个新密码。",
    input.url,
    `此链接在 ${input.expiresAt.toISOString()} 之前有效，只能使用一次。`,
  ]);
}

// Not exported — asserting the shape here is what turns a missing or renamed
// method into a type error rather than a message that arrives blank.
const _contract: EmailTemplates = { verificationCode, resetPassword };
void _contract;
