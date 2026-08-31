import type {
  EmailChangeMail,
  MailBody,
  PasswordResetMail,
  SecurityNoticeMail,
  VerificationLinkMail,
} from "@/lib/mail/types";
import { site } from "@/lib/site";
import { actionMail, formatMoment, noticeMail } from "./layout";

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

const CHANGED: Record<SecurityNoticeMail["kind"], string> = {
  password: "密码",
  username: "用户名",
};

export function securityNotice(input: SecurityNoticeMail): MailBody {
  const what = CHANGED[input.kind];

  return noticeMail({
    subject: `你的 ${site.name} ${what}已变更`,
    intro: [
      `${input.displayName}，你好：`,
      `你的${what}已于 ${formatMoment(input.changedAt)} 变更。`,
      ...(input.detail ? [input.detail] : []),
      ...(input.kind === "password"
        ? ["为了安全，其他设备上的登录状态已经全部失效，需要用新密码重新登录。"]
        : []),
    ],
    link: { label: "不是你本人操作？立即重置密码", url: input.recoverUrl },
    footnote: [
      "这封信只是变更通知，你不需要回复它。",
      "如果确认不是你本人操作，请在重置密码后联系管理员。",
    ],
  });
}
