"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/auth";
import { getPasswordFingerprint } from "@/lib/accounts/password";
import { reinstateAccount, suspendAccount } from "@/lib/accounts/queries";
import { resolveUser } from "@/lib/accounts/resolve";
import type { Denial } from "@/lib/authz/adapters";
import { authorize } from "@/lib/authz/engine";
import { sendPasswordReset } from "@/lib/mail/notify";
import { rateLimit } from "@/lib/ratelimit";
import { ACTION_LIMITS } from "@/lib/ratelimit/policy";

export interface ActionState {
  error?: string;
  message?: string;
}

/**
 * A bare "forbidden" usually means the button outlived the permission behind
 * it. Denials that name a specific rule speak for themselves.
 */
function refused(denial: Denial): ActionState {
  const stale =
    denial.reason.code === "forbidden"
      ? "——如果刚才还看得到这个按钮，多半是权限刚被收回，刷新页面即可。"
      : "";
  return { error: `${denial.reason.message}${stale}` };
}

const issueSchema = z.object({
  uid: z.coerce.number().int().positive("请选择用户"),
});

export async function resendPasswordResetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await getViewer();

  const rule = ACTION_LIMITS.resendPasswordResetAction;
  const limited = rateLimit(
    `resend-reset:${actor.uid}`,
    rule.max,
    rule.windowSeconds * 1000,
  );
  if (!limited.ok) {
    return {
      error: `代发重置邮件过于频繁，请 ${Math.ceil(limited.retryAfterMs / 60_000)} 分钟后再试。`,
    };
  }

  const parsed = issueSchema.safeParse({ uid: formData.get("uid") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  const user = await resolveUser(parsed.data.uid);
  if (!user) return { error: "没有这个账号" };

  const decision = authorize("account.sendPasswordReset", user, actor);
  if (!decision.allow) return refused(decision);

  if (!user.email || !user.emailVerified) {
    return {
      error:
        "该账号没有已验证的邮箱，无法发送重置邮件。请在服务器上直接设置密码。",
    };
  }

  const fp = await getPasswordFingerprint(user.uid);
  if (!fp) {
    return { error: "该账号没有设置密码，无法生成重置链接的 fingerprint。" };
  }

  try {
    await sendPasswordReset(
      { uid: user.uid, nickname: user.nickname, email: user.email },
      fp,
    );
  } catch (error) {
    console.error("[foi] 重置密码邮件发送失败", error);
    return {
      error: `邮件发送失败：${error instanceof Error ? error.message : "未知错误"}`,
    };
  }

  revalidatePath("/admin/accounts");
  return {
    message: `已向 ${user.username} 的邮箱发送重置链接，1 小时内有效。`,
  };
}

const moderateSchema = z.object({
  uid: z.coerce.number().int().positive("请选择账号"),
  reason: z.string().trim().max(200).optional(),
});

export async function suspendAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await getViewer();

  const parsed = moderateSchema.safeParse({
    uid: formData.get("uid"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  const target = await resolveUser(parsed.data.uid);
  if (!target) return { error: "没有这个账号" };

  const decision = authorize("account.suspend", target, actor);
  if (!decision.allow) return refused(decision);

  await suspendAccount(
    target.uid,
    actor.uid ?? 0,
    parsed.data.reason || "未填写原因",
  );

  revalidatePath("/admin/accounts");
  return { message: `已封禁 ${target.username}，其已登录的会话在下一个请求即失效。` };
}

export async function reinstateAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await getViewer();

  const parsed = moderateSchema.safeParse({ uid: formData.get("uid") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  const target = await resolveUser(parsed.data.uid);
  if (!target) return { error: "没有这个账号" };

  const decision = authorize("account.suspend", target, actor);
  if (!decision.allow) return refused(decision);

  if (target.status !== "suspended") {
    revalidatePath("/admin/accounts");
    return {
      error: `${target.username} 当前并未被封禁，没有改动任何东西——这一行大概是在别人解封之前加载的。`,
    };
  }

  const row = await reinstateAccount(target.uid, actor.uid ?? 0);
  if (!row) return { error: "没有这个账号" };

  revalidatePath("/admin/accounts");
  return { message: `已解封 ${row.username}。` };
}
