"use server";

import { z } from "zod";
import { resolveUser } from "@/lib/accounts/resolve";
import { setPassword } from "@/lib/auth/credentials";
import { redeemToken } from "@/lib/auth/tokens";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export interface ResetState {
  error?: string;
  message?: string;
}

const schema = z
  .object({
    token: z.string().min(1, "重置链接不完整"),
    password: z.string().min(8, "密码至少 8 位"),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    path: ["confirm"],
    message: "两次输入的密码不一致",
  });

/**
 * Spends a reset token on a new password.
 *
 * The token is the only credential presented here — it arrived at an address
 * the account has already proved it owns, and it is consumed atomically, so
 * the link works exactly once whichever tab gets there first.
 */
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

  // A 160-bit token is not guessable, so this is not about protecting the
  // link — it caps how much database and argon2 work one source can demand
  // from an endpoint that needs no session to reach.
  const limit = rateLimit(`reset:${await clientIp()}`, 20, 60 * 60 * 1000);
  if (!limit.ok) {
    return { error: "尝试过于频繁，请稍后再试。" };
  }

  const result = await redeemToken(parsed.data.token, "password_reset");
  if (!result.ok) {
    return {
      error:
        result.reason === "expired"
          ? "链接已过期，请重新申请一封重置邮件"
          : "链接无效或已被使用，请重新申请",
    };
  }

  const user = await resolveUser(result.handle);
  if (!user || user.disabled) {
    return { error: "该账号当前无法登录，请联系管理员" };
  }

  await setPassword(user.handle, parsed.data.password);
  return { message: `密码已更新，现在可以用 ${user.handle} 登录了。` };
}
