"use server";

import { z } from "zod";
import { redeemSetupCode } from "@/lib/auth/credentials";
import { getMember } from "@/lib/roster/registry";

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
 * invited, and the roster is not public.
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
  const member = getMember(handle);
  if (!member || member.disabled) {
    return { error: "用户名或设置码无效" };
  }

  const result = await redeemSetupCode(member.handle, code, password);
  if (!result.ok) {
    return {
      error:
        result.reason === "expired"
          ? "设置码已过期，请向管理员索取新的设置码"
          : "用户名或设置码无效",
    };
  }

  return { message: `密码已设置，现在可以用 ${member.handle} 登录了。` };
}
