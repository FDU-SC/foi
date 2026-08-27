"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { setPassword } from "@/lib/accounts/password";
import { getAccount } from "@/lib/accounts/queries";
import { resolveFromRow } from "@/lib/accounts/resolve";
import { redeemToken } from "@/lib/accounts/tokens";
import { db } from "@/lib/db";
import { rateLimitBySource, sourceFrom } from "@/lib/ratelimit";
import { ACTION_LIMITS } from "@/lib/ratelimit/policy";

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
  // from an endpoint that needs no session to reach. Which is also why it is
  // the least costly of the six to lose when no source can be established:
  // nothing is sent, nothing is created, and the work it meters is our own.
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

  // Spending the token and writing the password are one act. Apart, a failure
  // in the second left the link consumed and the password unchanged — the one
  // outcome the person cannot recover from on this page, because the only way
  // forward is another mail and the link they are holding will never work
  // again. Rolled back, the link in their inbox is still good.
  //
  // The account is read through `tx` rather than `resolveUser`, which would
  // take a second connection out of the pool while this one holds a
  // transaction open. `resolveFromRow` is the same merge `resolveUser` does.
  return db.transaction<ResetState>(async (tx) => {
    const result = await redeemToken(parsed.data.token, "password_reset", tx);
    if (!result.ok) {
      return {
        error:
          result.reason === "expired"
            ? "链接已过期，请重新申请一封重置邮件"
            : "链接无效或已被使用，请重新申请",
      };
    }

    // A refusal is not a failure, so this one commits: the link did reach the
    // right mailbox and was used, and the answer is to talk to an
    // administrator rather than to try the link again.
    const row = await getAccount(result.handle, tx);
    const user = row ? resolveFromRow(row) : null;
    if (!user || user.disabled) {
      return { error: "该账号当前无法登录，请联系管理员" };
    }

    await setPassword(user.handle, parsed.data.password, tx);
    return { message: `密码已更新，现在可以用 ${user.handle} 登录了。` };
  });
}
