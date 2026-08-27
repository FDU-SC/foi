"use server";

import { AuthError } from "next-auth";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { signIn } from "@/auth";
import { findAccountByEmail } from "@/lib/accounts/queries";
import {
  emailSchema,
  handleSchema,
  normalizeEmail,
} from "@/lib/accounts/types";
import { maxAttempts, verifyCode } from "@/lib/enrollment/email-verification";
import {
  checkRegistrationProof,
  issueRegistrationProof,
  REGISTRATION_PROOF_COOKIE,
  registrationProofCookieOptions,
} from "@/lib/enrollment/registration-proof";
import {
  domainAllowed,
  register,
  type RegisterRejection,
} from "@/lib/enrollment/register";
import { enrollmentPolicy } from "@/lib/enrollment/registry";
import { sendVerificationCode } from "@/lib/mail/notify";
import { rateLimitBySource, sourceFrom } from "@/lib/ratelimit";

function normalize(email: string): string {
  return normalizeEmail(email, {
    stripSubaddress: enrollmentPolicy.stripSubaddress,
  });
}

export interface SendCodeState {
  error?: string;

  sentTo?: string;
}

export async function sendCodeAction(
  rawEmail: string,
): Promise<SendCodeState> {
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

  const limit = rateLimitBySource(
    "send-code",
    sourceFrom(await headers()),
    enrollmentPolicy.registrationsPerIpPerHour,
    60 * 60 * 1000,
  );
  if (!limit.ok) return { error: "请求过于频繁，请稍后再试。" };

  try {
    const result = await sendVerificationCode(email);
    if (!result.ok) {
      return {
        error: `验证码刚刚发过，请 ${Math.ceil(result.retryAfterMs / 1000)} 秒后再试。`,
      };
    }
  } catch (error) {
    console.error("[foi] 验证码邮件发送失败", error);
    return { error: "邮件发送失败，请稍后再试或联系管理员。" };
  }

  return { sentTo: email };
}

export interface VerifyState {
  error?: string;
  verified?: boolean;
}

const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "验证码是 6 位数字");

const VERIFY_FAILURES = {
  "no-code": "还没有向这个邮箱发送过验证码，请先获取验证码。",
  expired: "验证码已过期，请重新获取。",
  "too-many-attempts": "错误次数过多，这个验证码已作废，请重新获取。",
} as const;

export async function verifyCodeAction(
  rawEmail: string,
  rawCode: string,
): Promise<VerifyState> {

  if (!enrollmentPolicy.enabled) return { error: "当前未开放注册。" };

  const email = emailSchema.safeParse(rawEmail);
  const code = codeSchema.safeParse(rawCode);

  if (!email.success) return { error: "邮箱地址不合法" };
  if (!code.success) {
    return { error: code.error.issues[0]?.message ?? "验证码不合法" };
  }

  const limit = rateLimitBySource(
    "verify-code",
    sourceFrom(await headers()),
    enrollmentPolicy.registrationsPerIpPerHour * maxAttempts,
    60 * 60 * 1000,
  );
  if (!limit.ok) return { error: "请求过于频繁，请稍后再试。" };

  const address = normalize(email.data);
  const result = await verifyCode(address, code.data);
  if (result.ok) {
    const jar = await cookies();

    if (result.matched) {
      jar.set(
        REGISTRATION_PROOF_COOKIE,
        issueRegistrationProof(address),
        registrationProofCookieOptions(),
      );
      return { verified: true };
    }

    const held = jar.get(REGISTRATION_PROOF_COOKIE)?.value;
    if (checkRegistrationProof(address, held)) return { verified: true };

    return { error: "验证码已失效，请重新获取。" };
  }

  if (result.reason === "mismatch") {
    return {
      error:
        result.attemptsLeft > 0
          ? `验证码不正确，还可以再试 ${result.attemptsLeft} 次。`
          : "验证码不正确，错误次数已用完，请重新获取。",
    };
  }

  return { error: VERIFY_FAILURES[result.reason] };
}

export interface RegisterState {
  error?: string;

  createdNeedsLogin?: boolean;
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

const HANDLE_UNAVAILABLE = "这个用户名不可用，换一个试试。";

const REJECTIONS: Record<RegisterRejection, string> = {
  disabled: "当前未开放注册。",
  "handle-taken": HANDLE_UNAVAILABLE,
  "handle-reserved": HANDLE_UNAVAILABLE,
  "email-domain": "这个邮箱域名不在允许注册的范围内。",
  "email-taken": "这个邮箱已经注册过了。如果是你本人，请用「找回密码」。",
  "email-unverified": "邮箱尚未验证，或验证已超时。请重新获取验证码。",
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

  const limit = rateLimitBySource(
    "register",
    sourceFrom(await headers()),
    enrollmentPolicy.registrationsPerIpPerHour,
    60 * 60 * 1000,
  );
  if (!limit.ok) {
    return { error: "注册过于频繁，请稍后再试。" };
  }

  const jar = await cookies();
  const proof = jar.get(REGISTRATION_PROOF_COOKIE)?.value;
  const result = await register({ ...parsed.data, proof });
  if (!result.ok) return { error: REJECTIONS[result.reason] };

  jar.delete(REGISTRATION_PROOF_COOKIE);

  try {
    await signIn("credentials", {
      handle: result.handle,
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
