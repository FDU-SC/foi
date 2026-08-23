import { actionMail, type MailBody } from "./layout";

/**
 * Every message FOI sends, as plain functions.
 *
 * This is copy, and copy is deployment-specific — a school competition and a
 * public CTF want different words for the same event — so it lives under
 * `content/` next to the problem statements and the enrollment rules rather
 * than in `lib/`. Adding a template means adding an export here and calling it
 * from wherever the event happens.
 */
export type { MailBody };

export function verifyEmail(input: {
  displayName: string;
  url: string;
  expiresAt: Date;
}): MailBody {
  return actionMail({
    subject: "验证你的 FOI 账号邮箱",
    intro: [
      `${input.displayName}，你好：`,
      "请点击下面的按钮完成注册。验证之后你就可以登录、提交题目，并按邮箱自动加入对应的比赛名单。",
    ],
    action: { label: "验证邮箱", url: input.url },
    expiresAt: input.expiresAt,
    footnote: ["如果不是你本人注册，忽略这封邮件即可，账号不会被启用。"],
  });
}

export function resetPassword(input: {
  displayName: string;
  url: string;
  expiresAt: Date;
}): MailBody {
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

export function setupCode(input: {
  displayName: string;
  url: string;
  expiresAt: Date;
}): MailBody {
  return actionMail({
    subject: "设置你的 FOI 密码",
    intro: [
      `${input.displayName}，你好：`,
      "管理员为你签发了一次性设置码。点击下面的按钮设置密码。",
    ],
    action: { label: "设置密码", url: input.url },
    expiresAt: input.expiresAt,
  });
}
