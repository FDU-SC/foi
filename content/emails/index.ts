import type {
  EmailChangeMail,
  MailBody,
  PasswordResetMail,
  VerificationLinkMail,
} from "@/lib/mail/types";
import { site } from "../site";
import { actionMail } from "./layout";

export type { MailBody };

export function verificationLink(input: VerificationLinkMail): MailBody {
  return actionMail({
    subject: `验证你的 ${site.name} 注册邮箱`,
    intro: [
      "你好：",
      `有人正在用这个邮箱注册 ${site.name} 账号。点击下面的按钮验证邮箱并继续注册。`,
    ],
    action: { label: "验证邮箱并注册", url: input.url },
    expiresAt: input.expiresAt,
    footnote: [
      "不要把这个链接转发给任何人。",
      "如果不是你本人操作，忽略这封邮件即可，不会有账号被创建。",
    ],
  });
}

export function resetPassword(input: PasswordResetMail): MailBody {
  return actionMail({
    subject: `重置你的 ${site.name} 密码`,
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

export function emailChange(input: EmailChangeMail): MailBody {
  return actionMail({
    subject: `确认更换 ${site.name} 邮箱`,
    intro: [
      `${input.displayName}，你好：`,
      `我们收到了将你的邮箱更换为 ${input.newEmail} 的请求。点击下面的按钮确认更换。`,
    ],
    action: { label: "确认更换邮箱", url: input.url },
    expiresAt: input.expiresAt,
    footnote: [
      "如果不是你本人操作，忽略这封邮件即可，你的邮箱不会有任何变化。",
    ],
  });
}
