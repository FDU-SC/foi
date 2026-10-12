"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { getViewer } from "@/auth";
import { getPasswordFingerprint, setPassword } from "@/lib/accounts/password";
import { getAccount } from "@/lib/accounts/queries";
import { resolveFromRow } from "@/lib/accounts/resolve";
import { allows } from "@/lib/authz/engine";
import { verifyToken } from "@/lib/tokens/stateless";
import { rateLimitBySource, sourceFrom } from "@/lib/ratelimit";
import { ACTION_LIMITS } from "@/lib/ratelimit/policy";
import { parseInput } from "@/lib/validation";
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
  const parsed = parseInput(schema, {
    token: formData.get("token"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.ok) return { error: parsed.error };

  const rule = ACTION_LIMITS.resetPasswordAction;
  const limit = await rateLimitBySource("reset", sourceFrom(await headers()), rule);
  if (!limit.ok) {
    return { error: "尝试过于频繁，请稍后再试。" };
  }

  const payload = await verifyToken(parsed.data.token, "password-reset");
  if (!payload) {
    return { error: "链接无效或已过期" };
  }

  const uid = parseInt(payload.s, 10);
  if (!uid || isNaN(uid)) {
    return { error: "链接无效" };
  }

  const fp = await getPasswordFingerprint(uid);
  if (!fp || fp !== payload.fp) {
    return { error: "链接已失效" };
  }

  const row = await getAccount(uid);
  const user = row ? resolveFromRow(row) : null;
  if (!user || !allows("account.resetPassword", user, await getViewer())) {
    return { error: "该账号当前无法登录" };
  }

  await setPassword(uid, parsed.data.password);
  return { message: `密码已更新，用户名为 ${user.username}。` };
}
