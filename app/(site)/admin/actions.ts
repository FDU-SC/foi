"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, requireCapability } from "@/auth";
import { reinstateAccount, suspendAccount } from "@/lib/accounts/queries";
import { resolveUser } from "@/lib/accounts/resolve";
import { hasPrivilege } from "@/lib/permissions/groups";
import type { Viewer } from "@/lib/permissions/viewer";
import { sendPasswordReset } from "@/lib/mail/notify";
import { rateLimit } from "@/lib/ratelimit";
import { ACTION_LIMITS } from "@/lib/ratelimit/policy";

export interface ActionState {
  error?: string;
  message?: string;
}

function refused(error: unknown): ActionState {
  if (error instanceof ForbiddenError) {
    return {
      error: `${error.message}——如果刚才还看得到这个按钮，多半是权限刚被收回，刷新页面即可。`,
    };
  }
  throw error;
}

const issueSchema = z.object({
  handle: z.string().min(1, "请选择用户"),
});

export async function resendPasswordResetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let actor: Viewer;
  try {
    actor = await requireCapability("credential.manage");
  } catch (error) {
    return refused(error);
  }

  const rule = ACTION_LIMITS.resendPasswordResetAction;
  const limited = rateLimit(
    `resend-reset:${actor.handle}`,
    rule.max,
    rule.windowSeconds * 1000,
  );
  if (!limited.ok) {
    return {
      error: `代发重置邮件过于频繁，请 ${Math.ceil(limited.retryAfterMs / 60_000)} 分钟后再试。`,
    };
  }

  const parsed = issueSchema.safeParse({ handle: formData.get("handle") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  const user = await resolveUser(parsed.data.handle);
  if (!user) return { error: "没有这个账号" };
  if (user.disabled) return { error: "该账号已封禁，无法发送重置邮件" };

  if (!user.email || !user.emailVerified) {
    return {
      error:
        "该账号没有已验证的邮箱，无法发送。请在服务器上用 scripts/set-password.cjs 直接设置密码。",
    };
  }

  let result;
  try {
    result = await sendPasswordReset({
      handle: user.handle,
      displayName: user.displayName,
      email: user.email,
    });
  } catch (error) {
    console.error("[foi] 重置密码邮件发送失败", error);
    return {
      error: `邮件发送失败：${error instanceof Error ? error.message : "未知错误"}`,
    };
  }

  if (!result.ok) {
    return {
      error: `刚刚已经发过一封，请 ${Math.ceil(result.retryAfterMs / 1000)} 秒后再试。`,
    };
  }

  revalidatePath("/admin/accounts");
  return {
    message: `已向 ${user.handle} 的邮箱发送重置链接，1 小时内有效。`,
  };
}

const moderateSchema = z.object({
  handle: z.string().min(1, "请选择账号"),
  reason: z.string().trim().max(200).optional(),
});

export async function suspendAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let actor: Viewer;
  try {
    actor = await requireCapability("account.moderate");
  } catch (error) {
    return refused(error);
  }

  const parsed = moderateSchema.safeParse({
    handle: formData.get("handle"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  const target = await resolveUser(parsed.data.handle);
  if (!target) return { error: "没有这个账号" };

  if (actor.handle === target.handle) {
    return { error: "不能封禁自己" };
  }

  if (hasPrivilege(target.groups)) {
    return {
      error:
        "这个账号属于带权限的用户组，不能在这里封禁。收回权限请改 content/enrollment/ 里点名它的那条规则，那样改动会留在 git 历史里。",
    };
  }

  await suspendAccount(
    target.handle,
    actor.handle ?? "unknown",
    parsed.data.reason || "未填写原因",
  );

  revalidatePath("/admin/accounts");
  return { message: `已封禁 ${target.handle}，其已登录的会话在下一个请求即失效。` };
}

export async function reinstateAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let actor: Viewer;
  try {
    actor = await requireCapability("account.moderate");
  } catch (error) {
    return refused(error);
  }

  const parsed = moderateSchema.safeParse({ handle: formData.get("handle") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  const target = await resolveUser(parsed.data.handle);
  if (!target) return { error: "没有这个账号" };

  if (target.status !== "suspended") {
    revalidatePath("/admin/accounts");
    return {
      error: `${target.handle} 当前并未被封禁，没有改动任何东西——这一行大概是在别人解封之前加载的。`,
    };
  }

  const row = await reinstateAccount(target.handle, actor.handle ?? "unknown");
  if (!row) return { error: "没有这个账号" };

  revalidatePath("/admin/accounts");
  return { message: `已解封 ${row.handle}。` };
}
