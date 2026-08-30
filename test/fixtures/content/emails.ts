import type {
  EmailChangeMail,
  MailBody,
  PasswordResetMail,
  SecurityNoticeMail,
  VerificationLinkMail,
} from "@/lib/mail/types";

function body(subject: string, text: string): MailBody {
  return { subject, text, html: `<p>${text}</p>` };
}

export function verificationLink(input: VerificationLinkMail): MailBody {
  return body("验证邮箱", `打开 ${input.url} 完成验证。`);
}

export function resetPassword(input: PasswordResetMail): MailBody {
  return body("重设密码", `${input.displayName}，打开 ${input.url} 重设密码。`);
}

export function emailChange(input: EmailChangeMail): MailBody {
  return body(
    "确认新邮箱",
    `${input.displayName}，打开 ${input.url} 把邮箱换成 ${input.newEmail}。`,
  );
}

export function securityNotice(input: SecurityNoticeMail): MailBody {
  return body(
    "账号变更提醒",
    `${input.displayName}，你的${input.kind}刚刚被改动。` +
      `不是本人操作请打开 ${input.recoverUrl}。`,
  );
}
