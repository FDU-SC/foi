import type {
  MailBody,
  PasswordResetMail,
  VerificationCodeMail,
} from "@/lib/mail/types";
import { actionMail, codeMail } from "./layout";

/**
 * Every message FOI sends, as plain functions.
 *
 * This is copy, and copy is deployment-specific — a school competition and a
 * public CTF want different words for the same event — so it lives under
 * `content/` next to the problem statements and the enrollment rules rather
 * than in `lib/`. The kernel finds this file through `content/email-modules.ts`
 * and checks that both exports are here; which messages exist is its decision,
 * what they say is this file's.
 */
export type { MailBody };

/**
 * Addressed to nobody by name, and that is not an oversight: this goes out
 * before an account exists, so there is no display name to greet — only an
 * address somebody has claimed and not yet proved.
 */
export function verificationCode(input: VerificationCodeMail): MailBody {
  return codeMail({
    subject: "验证你的 FOI 注册邮箱",
    intro: [
      "你好：",
      "有人正在用这个邮箱注册 FOI 账号。请回到注册页面填入下面的验证码，验证通过后才会创建账号。",
    ],
    code: input.code,
    expiresAt: input.expiresAt,
    footnote: [
      "不要把验证码转发给任何人。",
      "如果不是你本人操作，忽略这封邮件即可，不会有账号被创建。",
    ],
  });
}

export function resetPassword(input: PasswordResetMail): MailBody {
  return actionMail({
    subject: "重置你的 FOI 密码",
    intro: [
      `${input.displayName}，你好：`,
      "我们收到了重置密码的请求。点击下面的按钮设置一个新密码。",
    ],
    action: { label: "重置密码", url: input.url },
    expiresAt: input.expiresAt,
    footnote: [
      "如果不是你本人操作，忽略这封邮件即可，你的密码不会有任何变化。",
    ],
  });
}
