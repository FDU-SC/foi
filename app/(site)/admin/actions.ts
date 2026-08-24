"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCapability } from "@/auth";
import { reinstateAccount, suspendAccount } from "@/lib/accounts/queries";
import { resolveUser } from "@/lib/accounts/resolve";
import { capabilitiesOf } from "@/lib/auth/groups";
import { sendPasswordReset } from "@/lib/mail/notify";

export interface ActionState {
  error?: string;
  message?: string;
}

// Every action starts with `requireCapability`, which lives in `@/auth`
// alongside `getViewer` because it asks the same question and answers it the
// same way — it just refuses instead of returning false. Server Actions are
// reachable by POST regardless of what the proxy matched, which is why the
// route is never trusted here.
//
// There used to be a third action here, pushing the filesystem registries into
// their mirror tables by hand. It went when the startup sync did: mirror rows
// are written on the submission path now, at the moment a foreign key first
// needs one, so there is nothing left for an operator to trigger.

const issueSchema = z.object({
  handle: z.string().min(1, "请选择用户"),
});

/**
 * Sends somebody a password reset they did not ask for.
 *
 * This replaces the administrator-issued setup code, and the difference is the
 * point: the code had to be read off this screen and carried to its owner over
 * chat, which left a credential capable of taking over the account sitting in
 * a message history, with no way to tell it had gone to the wrong person. Here
 * the administrator triggers the mail and the secret goes straight to the
 * address the account already proved it controls.
 *
 * An account with no usable address is out of scope on purpose. Every account
 * created since has one, so what is left here is a mailbox that has stopped
 * working — and that case belongs to `scripts/set-password.cjs`, which needs
 * shell access on the server: the right bar for the one path that bypasses
 * email entirely.
 */
export async function resendPasswordResetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireCapability("credential.manage");

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

/**
 * Locks an account out.
 *
 * This is the one authorisation decision that is data rather than code, and
 * deliberately so: banning a spam signup should not require a pull request,
 * and adding one throwaway handle per incident to a repository file would make
 * that file useless. It is still an accountable act, so who did it and why is
 * recorded on the row.
 *
 * Which is also why it stops at the edge of the privileged groups. Everything
 * that grants power is a reviewed commit naming a person; if taking it away
 * were a button, one holder could remove the others between two page loads and
 * the repository would still say they were administrators. Nobody gets to
 * shortcut that, themselves included.
 *
 * It bites immediately. `getResolvedUser()` reads the account by primary key
 * on every request and never through the snapshot, so an open session stops
 * working on its next page load rather than when a token expires.
 */
export async function suspendAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // The viewer comes back from the check, so the actor's identity does not
  // need fetching a second time by a second route.
  const actor = await requireCapability("account.moderate");

  const parsed = moderateSchema.safeParse({
    handle: formData.get("handle"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  const target = await resolveUser(parsed.data.handle);
  if (!target) return { error: "没有这个账号" };

  // Locking yourself out of the only administrator account would need a
  // database session to undo.
  if (actor.handle === target.handle) {
    return { error: "不能封禁自己" };
  }

  // Nor anybody else who holds the same power. Suspension is the one
  // authorisation decision that is data rather than code, which is what makes
  // it fast enough for a spam signup — and also what would let one
  // administrator remove the others without a review. Taking privilege away is
  // a commit against `content/enrollment/`, the same way granting it is.
  if (capabilitiesOf(target.groups).size > 0) {
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
  await requireCapability("account.moderate");

  const parsed = moderateSchema.safeParse({ handle: formData.get("handle") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  const row = await reinstateAccount(parsed.data.handle);
  if (!row) return { error: "没有这个账号" };

  revalidatePath("/admin/accounts");
  return { message: `已解封 ${row.handle}。` };
}
