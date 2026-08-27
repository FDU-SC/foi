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

// Every action starts with `requireCapability`. Server Actions are reachable
// by POST regardless of what the proxy matched, so the route is never trusted
// here.

/**
 * Turns a refusal into the shape these forms already speak, and rethrows
 * everything else.
 *
 * Rethrowing the rest is the load-bearing half: a database that has gone away
 * is not a permission problem and must not be reported as one — that belongs
 * to `app/error.tsx`.
 *
 * These three actions convert because they have somewhere to put the answer
 * and because it is a failure an operator reaches without doing anything
 * strange: the buttons are drawn from a capability check on the server-rendered
 * page (see `PAGE_CHECKS`), so a console left open across a privilege change
 * still offers one. The sentence comes off the error so that what a refusal is
 * called has one home.
 */
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

/**
 * Sends somebody a password reset they did not ask for.
 *
 * The operator triggers the mail and never sees the secret, which is the whole
 * difference from the administrator-issued setup code this replaced.
 *
 * An account with no usable address is out of scope on purpose: what that
 * describes is a mailbox that has stopped working, and that case belongs to
 * `scripts/set-password.cjs`, which needs shell access on the server — the
 * right bar for the one path that bypasses email entirely.
 */
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

  /**
   * Bounded per operator, which the cooldown in `lib/mail/notify.ts` does not
   * do: that one stops the *same* account being mailed twice a minute and says
   * nothing about how many different accounts one session may mail. Without
   * this, a stolen `credential.manage` session sends one message per account
   * per minute, from this deployment's domain, for as long as it lasts.
   */
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

/**
 * Locks an account out — the one authorisation decision that is data rather
 * than code, so that banning a spam signup does not require a pull request.
 *
 * It bites immediately: `getResolvedUser()` reads the account by primary key
 * on every request and never through the snapshot, so an open session stops
 * working on its next page load rather than when a token expires.
 */
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

  // Locking yourself out of the only administrator account would need a
  // database session to undo.
  if (actor.handle === target.handle) {
    return { error: "不能封禁自己" };
  }

  // Nor anybody else who holds power. Being data rather than code is what
  // makes suspension fast enough for a spam signup, and also what would let
  // one administrator remove the others between two page loads while the
  // repository still said they were administrators. Taking privilege away is a
  // commit against `content/enrollment/`, the same way granting it is.
  //
  // Asked through the shared predicate, so the button that offers this and the
  // guard that refuses it cannot answer differently.
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

/**
 * Lifts a suspension, and only ever a suspension.
 *
 * The status is read before it is written because `reinstateAccount` writes
 * "active" over whatever was there and hands back a row either way — so an
 * account nobody had suspended would come back reported as reinstated, on the
 * one screen whose whole job is to say what the database actually holds.
 */
export async function reinstateAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireCapability("account.moderate");
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

  const row = await reinstateAccount(target.handle);
  if (!row) return { error: "没有这个账号" };

  revalidatePath("/admin/accounts");
  return { message: `已解封 ${row.handle}。` };
}
