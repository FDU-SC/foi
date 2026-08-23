"use server";

import { z } from "zod";
import { findAccountByEmail } from "@/lib/accounts/queries";
import {
  emailSchema,
  handleSchema,
  normalizeEmail,
} from "@/lib/accounts/types";
import { enrollmentPolicy } from "@/lib/enrollment/registry";
import { register, type RegisterRejection } from "@/lib/enrollment/register";
import { sendVerification } from "@/lib/mail/notify";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export interface RegisterState {
  error?: string;
  /** Set once the account exists and the verification mail is on its way. */
  sentTo?: string;
}

const schema = z
  .object({
    handle: handleSchema,
    displayName: z.string().trim().min(1, "请填写显示名").max(64, "显示名过长"),
    email: emailSchema,
    password: z.string().min(8, "密码至少 8 位"),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    path: ["confirm"],
    message: "两次输入的密码不一致",
  });

/**
 * Unlike the login and recovery forms, this one says exactly what went wrong.
 *
 * Being vague there is worth it because it stops the form being used to test
 * whether somebody has an account. A registration form cannot make the same
 * trade: "that username is taken" is the only thing that lets a person pick
 * another one. Handles are public anyway — they appear on every standings
 * page.
 *
 * Saying an address is already registered does leak something not otherwise
 * visible. The alternative is worse: somebody who forgot they had an account
 * would be stuck on an error they cannot act on. Naming it and pointing at
 * password recovery is the actionable answer.
 */
const REJECTIONS: Record<RegisterRejection, string> = {
  disabled: "当前未开放注册。",
  "handle-taken": "这个用户名已经被占用了，换一个试试。",
  "handle-reserved": "这个用户名已被保留，换一个试试。",
  "email-domain": "这个邮箱域名不在允许注册的范围内。",
  "email-taken": "这个邮箱已经注册过了。如果是你本人，请用「找回密码」。",
};

export async function registerAction(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  if (!enrollmentPolicy.enabled) return { error: REJECTIONS.disabled };

  const parsed = schema.safeParse({
    handle: formData.get("handle"),
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  const limit = rateLimit(
    `register:${await clientIp()}`,
    enrollmentPolicy.registrationsPerIpPerHour,
    60 * 60 * 1000,
  );
  if (!limit.ok) {
    return { error: "注册过于频繁，请稍后再试。" };
  }

  const result = await register(parsed.data);
  if (!result.ok) return { error: REJECTIONS[result.reason] };

  try {
    await sendVerification(result);
  } catch (error) {
    // The account exists but its address is unproven and nothing will arrive.
    // Say so: the alternative is a person waiting on an email that was never
    // accepted by anything. The handle is theirs, and the resend on the next
    // page is what gets them out of it.
    console.error("[foi] 验证邮件发送失败", error);
    return {
      sentTo: result.email,
      error: "账号已创建，但验证邮件发送失败，请稍后重新发送。",
    };
  }

  return { sentTo: result.email };
}

export interface ResendState {
  error?: string;
  message?: string;
}

/**
 * Sends the verification mail again.
 *
 * Takes the address rather than the handle so that the just-registered page
 * can offer it without holding a session. Only ever acts on an account that is
 * still `pending`, so it cannot be used to spray mail at somebody who has
 * already finished — and the durable one-a-minute throttle in
 * `lib/auth/tokens.ts` bounds the rest.
 */
export async function resendVerification(
  _prev: ResendState,
  formData: FormData,
): Promise<ResendState> {
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) return { error: "邮箱地址不合法" };

  const limit = rateLimit(`resend:${await clientIp()}`, 10, 60 * 60 * 1000);
  if (!limit.ok) return { error: "请求过于频繁，请稍后再试。" };

  const account = await findAccountByEmail(
    normalizeEmail(email.data, {
      stripSubaddress: enrollmentPolicy.stripSubaddress,
    }),
  );
  if (!account || account.status !== "pending" || !account.email) {
    return { message: "如果该邮箱还有待验证的注册，我们已重新发送验证邮件。" };
  }

  try {
    const result = await sendVerification({
      handle: account.handle,
      displayName: account.displayName,
      email: account.email,
    });
    return {
      message: result.ok
        ? "验证邮件已重新发送，请查收。"
        : `发送过于频繁，请 ${Math.ceil(result.retryAfterMs / 1000)} 秒后再试。`,
    };
  } catch (error) {
    console.error("[foi] 验证邮件重发失败", error);
    return { error: "邮件发送失败，请稍后再试或联系管理员。" };
  }
}
