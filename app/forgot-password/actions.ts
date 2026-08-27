"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { getPasswordFingerprint } from "@/lib/accounts/password";
import { findAccountByEmail, getAccount } from "@/lib/accounts/queries";
import { resolveFromRow } from "@/lib/accounts/resolve";
import { normalizeEmail } from "@/lib/accounts/types";
import { enrollmentPolicy } from "@/lib/enrollment/registry";
import { sendPasswordReset, type Recipient } from "@/lib/mail/notify";
import { rateLimitBySource, sourceFrom } from "@/lib/ratelimit";
import { ACTION_LIMITS } from "@/lib/ratelimit/policy";

export interface ForgotState {
  error?: string;
  message?: string;
}

const schema = z.object({
  identifier: z.string().trim().min(1, "请填写用户名或邮箱"),
});

const SENT = "如果该账号存在且已验证邮箱，我们已经发送了重置链接，请查收。";

export async function requestPasswordReset(
  _prev: ForgotState,
  formData: FormData,
): Promise<ForgotState> {
  const parsed = schema.safeParse({ identifier: formData.get("identifier") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  const rule = ACTION_LIMITS.requestPasswordReset;
  const limit = rateLimitBySource(
    "forgot",
    sourceFrom(await headers()),
    rule.max,
    rule.windowSeconds * 1000,
  );
  if (!limit.ok) {
    return { error: "请求过于频繁，请稍后再试。" };
  }

  const { identifier } = parsed.data;
  const row = identifier.includes("@")
    ? await findAccountByEmail(

        normalizeEmail(identifier, {
          stripSubaddress: enrollmentPolicy.stripSubaddress,
        }),
      )
    : await getAccount(identifier);

  if (row) {
    const user = resolveFromRow(row);

    if (!user.disabled && user.email && user.emailVerified) {
      await notifyQuietly({
        handle: user.handle,
        displayName: user.displayName,
        email: user.email,
      });
    }
  }

  return { message: SENT };
}

async function notifyQuietly(to: Recipient): Promise<void> {
  try {
    const fp = await getPasswordFingerprint(to.handle);
    if (!fp) return;

    await sendPasswordReset(to, fp);
    console.log(`[foi] 找回密码: 已向 ${to.handle} 发出重置链接`);
  } catch (error) {
    console.error(`[foi] 找回密码: 向 ${to.handle} 投递重置邮件失败`, error);
  }
}
