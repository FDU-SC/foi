"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/auth";
import { getPasswordFingerprint } from "@/lib/accounts/password";
import { reinstateAccount, suspendAccount } from "@/lib/accounts/queries";
import { resolveUser } from "@/lib/accounts/resolve";
import type { Denial } from "@/lib/authz/adapters";
import { authorize } from "@/lib/authz/engine";
import { log } from "@/lib/log";
import { sendPasswordReset } from "@/lib/mail/notify";
import { rateLimit } from "@/lib/ratelimit";
import { ACTION_LIMITS } from "@/lib/ratelimit/policy";
import { parseInput } from "@/lib/validation";

export interface ActionState {
  error?: string;
  message?: string;
}

function refused(denial: Denial): ActionState {
  return { error: denial.reason.message };
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
  const limited = await rateLimit(`resend-reset:${actor.uid}`, rule);
  if (!limited.ok) {
    return {
      error: `代发重置邮件过于频繁，请 ${Math.ceil(limited.retryAfterMs / 60_000)} 分钟后再试。`,
    };
  }

  const parsed = parseInput(issueSchema, { uid: formData.get("uid") });
  if (!parsed.ok) return { error: parsed.error };

  const user = await resolveUser(parsed.data.uid);
  if (!user) return { error: "没有这个账号" };

  const decision = authorize("account.sendPasswordReset", user, actor);
  if (!decision.allow) return refused(decision);

  if (!user.email || !user.emailVerified) {
    return { error: "该账号没有已验证的邮箱。" };
  }

  const fp = await getPasswordFingerprint(user.uid);
  if (!fp) {
    return { error: "该账号尚未设置密码。" };
  }

  try {
    await sendPasswordReset(
      { uid: user.uid, nickname: user.nickname, email: user.email },
      fp,
    );
  } catch (error) {
    log.error({ err: error }, "重置密码邮件发送失败");
    return { error: "邮件发送失败。" };
  }

  revalidatePath("/admin/accounts");
  return {
    message: `已向 ${user.username} 发送重置邮件。`,
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

  const parsed = parseInput(moderateSchema, {
    uid: formData.get("uid"),
    reason: formData.get("reason"),
  });
  if (!parsed.ok) return { error: parsed.error };

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
  return { message: `已封禁 ${target.username}。` };
}

export async function reinstateAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await getViewer();

  const parsed = parseInput(moderateSchema, { uid: formData.get("uid") });
  if (!parsed.ok) return { error: parsed.error };

  const target = await resolveUser(parsed.data.uid);
  if (!target) return { error: "没有这个账号" };

  const decision = authorize("account.suspend", target, actor);
  if (!decision.allow) return refused(decision);

  if (target.status !== "suspended") {
    revalidatePath("/admin/accounts");
    return {
      error: `${target.username} 当前未被封禁。`,
    };
  }

  const row = await reinstateAccount(target.uid, actor.uid ?? 0);
  if (!row) return { error: "没有这个账号" };

  revalidatePath("/admin/accounts");
  return { message: `已解封 ${row.username}。` };
}
