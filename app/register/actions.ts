"use server";

import { z } from "zod";
import { findAccountByEmail, getAccount } from "@/lib/accounts/queries";
import { resolveFromRow } from "@/lib/accounts/resolve";
import {
  emailSchema,
  handleSchema,
  normalizeEmail,
} from "@/lib/accounts/types";
import { maxAttempts, verifyCode } from "@/lib/auth/email-verification";
import {
  domainAllowed,
  register,
  type RegisterRejection,
} from "@/lib/enrollment/register";
import { enrollmentPolicy } from "@/lib/enrollment/registry";
import { sendVerificationCode } from "@/lib/mail/notify";
import { clientIp, rateLimit } from "@/lib/ratelimit";

/**
 * Registration in three steps, because proving the address now comes first.
 *
 * The account is created last and created active. Nothing exists until the
 * code has been typed back, which is what removes the half-made account the
 * old link flow left behind whenever somebody never clicked.
 *
 * Sending and checking the code are separate calls rather than fields on the
 * final submit. Folding them in would mean a username collision — discovered
 * only at the end — also burns the code, sending someone back to their inbox
 * for a mistake that has nothing to do with their address.
 */
function normalize(email: string): string {
  return normalizeEmail(email, {
    stripSubaddress: enrollmentPolicy.stripSubaddress,
  });
}

export interface SendCodeState {
  error?: string;
  /** Set once a code is on its way; the form switches to asking for it. */
  sentTo?: string;
}

/**
 * Says plainly when an address is already registered, for the same reason the
 * form names a taken username: the alternative is somebody waiting on an email
 * that was never going to arrive, with no way to work out why. Password
 * recovery is the actionable answer and this is where to point at it.
 */
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

  const limit = rateLimit(
    `send-code:${await clientIp()}`,
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
  const email = emailSchema.safeParse(rawEmail);
  const code = codeSchema.safeParse(rawCode);

  if (!email.success) return { error: "邮箱地址不合法" };
  if (!code.success) {
    return { error: code.error.issues[0]?.message ?? "验证码不合法" };
  }

  // The per-address attempt cap is what actually protects a six-digit code;
  // this only bounds how much traffic one source can aim at the endpoint, and
  // is sized at every guess an IP could legitimately need — one full set of
  // attempts for each registration it is allowed in an hour.
  const limit = rateLimit(
    `verify-code:${await clientIp()}`,
    enrollmentPolicy.registrationsPerIpPerHour * maxAttempts,
    60 * 60 * 1000,
  );
  if (!limit.ok) return { error: "请求过于频繁，请稍后再试。" };

  const result = await verifyCode(normalize(email.data), code.data);
  if (result.ok) return { verified: true };

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
  /** Set once the account exists. There is nothing left to wait for. */
  created?: { handle: string; groups: string[] };
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
 */
const REJECTIONS: Record<RegisterRejection, string> = {
  disabled: "当前未开放注册。",
  "handle-taken": "这个用户名已经被占用了，换一个试试。",
  "handle-reserved": "这个用户名已被保留，换一个试试。",
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

  // Showing the groups is how a mistyped address gets caught: they come from
  // the address, so an empty list right after signing up is the earliest and
  // clearest sign something is off.
  const account = await getAccount(result.handle);
  return {
    created: {
      handle: result.handle,
      groups: account ? resolveFromRow(account).groups : [],
    },
  };
}
