"use server";

import { z } from "zod";
import { resolveUser } from "@/lib/accounts/resolve";
import { setPassword } from "@/lib/auth/credentials";
import { redeemToken } from "@/lib/auth/tokens";

export interface SetupState {
  error?: string;
  message?: string;
}

const setupSchema = z
  .object({
    handle: z.string().min(1, "请填写用户名"),
    code: z.string().min(1, "请填写设置码"),
    password: z.string().min(8, "密码至少 8 位"),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    path: ["confirm"],
    message: "两次输入的密码不一致",
  });

/**
 * Exchanges a setup code for a password.
 *
 * Every failure returns the same message. Distinguishing "no such handle"
 * from "wrong code" would turn this form into a way to find out who has been
 * invited, and who has been is not public.
 */
export async function redeemSetupCodeAction(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState> {
  const parsed = setupSchema.safeParse({
    handle: formData.get("handle"),
    code: formData.get("code"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  const { handle, code, password } = parsed.data;

  // Checked before the code is spent, so a suspended account does not burn
  // somebody's one-shot token on its way to being refused.
  const user = await resolveUser(handle);
  if (!user || user.disabled) {
    return { error: "用户名或设置码无效" };
  }

  const result = await redeemToken(code, "setup_code", { expectHandle: handle });
  if (!result.ok) {
    return {
      error:
        result.reason === "expired"
          ? "设置码已过期，请向管理员索取新的设置码"
          : "用户名或设置码无效",
    };
  }

  await setPassword(result.handle, password);
  return { message: `密码已设置，现在可以用 ${result.handle} 登录了。` };
}
