"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { getPasswordFingerprint, setPassword } from "@/lib/accounts/password";
import { getAccount } from "@/lib/accounts/queries";
import { resolveFromRow } from "@/lib/accounts/resolve";
import { verifyToken } from "@/lib/tokens/stateless";
import { rateLimitBySource, sourceFrom } from "@/lib/ratelimit";
import { ACTION_LIMITS } from "@/lib/ratelimit/policy";
import { site } from "@/lib/site";

export interface ResetState {
  error?: string;
  message?: string;
}

const schema = z
  .object({
    token: z.string().min(1, "重置链接不完整"),
    password: z.string().min(site.passwordMinLength ?? 8, `密码至少 ${site.passwordMinLength ?? 8} 位`),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    path: ["confirm"],
    message: "两次输入的密码不一致",
  });

export async function resetPasswordAction(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const parsed = schema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  const rule = ACTION_LIMITS.resetPasswordAction;
  const limit = rateLimitBySource(
    "reset",
    sourceFrom(await headers()),
    rule.max,
    rule.windowSeconds * 1000,
  );
  if (!limit.ok) {
    return { error: "尝试过于频繁，请稍后再试。" };
  }

  const payload = verifyToken(parsed.data.token, "password-reset");
  if (!payload) {
    return { error: "链接无效或已过期，请重新申请一封重置邮件" };
  }

  const uid = parseInt(payload.s, 10);
  if (!uid || isNaN(uid)) {
    return { error: "链接无效" };
  }

  const fp = await getPasswordFingerprint(uid);
  if (!fp || fp !== payload.fp) {
    return { error: "链接已失效（密码已被修改），请重新申请" };
  }

  const row = await getAccount(uid);
  const user = row ? resolveFromRow(row) : null;
  if (!user || user.disabled) {
    return { error: "该账号当前无法登录，请联系管理员" };
  }

  await setPassword(uid, parsed.data.password);
  return { message: `密码已更新，现在可以用 ${user.username} 登录了。` };
}
