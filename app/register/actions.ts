"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { z } from "zod";
import { signIn } from "@/auth";
import { findAccountByEmail } from "@/lib/accounts/queries";
import {
  emailSchema,
  usernameSchema,
  normalizeEmail,
} from "@/lib/accounts/types";
import {
  domainAllowed,
  register,
  type RegisterRejection,
} from "@/lib/enrollment/register";
import { enrollmentPolicy } from "@/lib/enrollment/registry";
import { sendVerificationLink } from "@/lib/mail/notify";
import { rateLimitBySource, sourceFrom } from "@/lib/ratelimit";
import { site } from "@/lib/site";
import { ACTION_LIMITS } from "@/lib/ratelimit/policy";

function normalize(email: string): string {
  return normalizeEmail(email, {
    stripSubaddress: enrollmentPolicy.stripSubaddress,
  });
}

export interface SendLinkState {
  error?: string;
  sent?: boolean;
}

export async function sendVerificationLinkAction(
  rawEmail: string,
): Promise<SendLinkState> {
  if (!enrollmentPolicy.enabled) return { error: "当前未开放注册。" };

  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "请填写有效的邮箱地址" };
  }

  const email = normalize(parsed.data);

  if (!domainAllowed(email)) {
    return { error: "这个邮箱域名不在允许注册的范围内。" };
  }
  if (await findAccountByEmail(email)) {
    return { error: "这个邮箱已经注册过了。如果是你本人，请用「找回密码」。" };
  }

  const { max, windowSeconds } = ACTION_LIMITS.sendVerificationLinkAction;
  const limit = rateLimitBySource(
    "send-verification-link",
    sourceFrom(await headers()),
    max,
    windowSeconds * 1000,
  );
  if (!limit.ok) return { error: "请求过于频繁，请稍后再试。" };

  try {
    await sendVerificationLink(email);
  } catch (error) {
    console.error("[foi] 验证邮件发送失败", error);
    return { error: "邮件发送失败，请稍后再试或联系管理员。" };
  }

  return { sent: true };
}

export interface RegisterState {
  error?: string;
  createdNeedsLogin?: boolean;
}

const schema = z
  .object({
    username: usernameSchema,
    nickname: z.string().trim().min(1, "请填写昵称").max(64, "昵称过长"),
    email: emailSchema,
    password: z.string().min(site.passwordMinLength ?? 8, `密码至少 ${site.passwordMinLength ?? 8} 位`),
    confirm: z.string(),
    token: z.string().min(1, "验证链接不完整"),
  })
  .refine((data) => data.password === data.confirm, {
    path: ["confirm"],
    message: "两次输入的密码不一致",
  });

const USERNAME_UNAVAILABLE = "这个用户名不可用，换一个试试。";

const REJECTIONS: Record<RegisterRejection, string> = {
  disabled: "当前未开放注册。",
  "username-taken": USERNAME_UNAVAILABLE,
  "email-domain": "这个邮箱域名不在允许注册的范围内。",
  "email-taken": "这个邮箱已经注册过了。如果是你本人，请用「找回密码」。",
  "email-unverified": "验证链接无效或已过期，请重新获取。",
};

export async function registerAction(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  if (!enrollmentPolicy.enabled) return { error: REJECTIONS.disabled };

  const parsed = schema.safeParse({
    username: formData.get("username"),
    nickname: formData.get("nickname"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
    token: formData.get("token"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  const reg = ACTION_LIMITS.registerAction;
  const limit = rateLimitBySource(
    "register",
    sourceFrom(await headers()),
    reg.max,
    reg.windowSeconds * 1000,
  );
  if (!limit.ok) {
    return { error: "注册过于频繁，请稍后再试。" };
  }

  const result = await register(parsed.data);
  if (!result.ok) return { error: REJECTIONS[result.reason] };

  try {
    await signIn("credentials", {
      identifier: result.username,
      password: parsed.data.password,
      redirectTo: "/",
    });
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;

    console.error("[foi] 注册后自动登录失败", error);
    return { createdNeedsLogin: true };
  }

  throw new Error("signIn 没有重定向，注册后的登录结果未知");
}
