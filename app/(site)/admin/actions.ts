"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/auth";
import { resolveUser } from "@/lib/accounts/resolve";
import type { Capability } from "@/lib/auth/policy";
import { userCan } from "@/lib/auth/session";
import { issueToken } from "@/lib/auth/tokens";
import { syncContests } from "@/lib/contests/queries";
import { sendSetupCode } from "@/lib/mail/notify";
import { syncProblems } from "@/lib/problems/sync";

export interface ActionState {
  error?: string;
  message?: string;
  /** Shown once and never persisted in plaintext. */
  setupCode?: string;
}

/**
 * Whether the code was handed over on screen or sent to the account's inbox.
 *
 * Mailing it is better when there is an address to mail: the code then only
 * ever exists in the recipient's mailbox, rather than passing through an
 * administrator's screen and whatever they paste it into.
 */
function issuedMessage(handle: string, mailed: boolean): string {
  return mailed
    ? `已把设置链接发送到 ${handle} 的邮箱，7 天内有效。`
    : `已为 ${handle} 签发设置码，7 天内有效。该账号没有邮箱，请当面转交。`;
}

/**
 * Server Actions are reachable by POST regardless of what the proxy matched,
 * so every one of them re-checks the capability rather than trusting the
 * route. Naming the capability instead of the role also means the check
 * survives a change to who holds it.
 */
async function requireCapability(capability: Capability): Promise<void> {
  const user = await getSessionUser();
  if (!userCan(user, capability)) throw new Error("FORBIDDEN");
}

/**
 * Pushes both filesystem registries into their mirror tables.
 *
 * Startup does this automatically; the button exists for the case where a
 * registry changed under a running server and the operator would rather not
 * wait for a restart.
 */
export async function syncRegistriesAction(): Promise<ActionState> {
  await requireCapability("registry.sync");

  const [problems, contests] = await Promise.all([
    syncProblems(),
    syncContests(),
  ]);

  revalidatePath("/admin");
  revalidatePath("/problems");
  revalidatePath("/contests");
  return {
    message: `已同步 ${problems.synced} 道题目、${contests.synced} 场比赛`,
  };
}

/** Same as above, shaped for `useActionState`. */
export async function syncRegistriesFormAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return syncRegistriesAction();
}

const issueSchema = z.object({
  handle: z.string().min(1, "请选择用户"),
});

/**
 * Hands somebody a way to set a password without knowing their old one.
 *
 * This is the fallback for an account with no address to mail — the bootstrap
 * administrator, or anyone whose mailbox has stopped working. Everyone else
 * uses the self-service reset, which sends the same kind of token to an
 * address that has already been proved.
 */
export async function issueSetupCodeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireCapability("credential.manage");

  const parsed = issueSchema.safeParse({ handle: formData.get("handle") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  const user = await resolveUser(parsed.data.handle);
  if (!user) {
    return { error: "没有这个账号" };
  }
  if (user.disabled) {
    return { error: "该账号已停用，无法签发设置码" };
  }

  const { token, expiresAt } = await issueToken(user.handle, "setup_code");

  if (user.email && user.emailVerified) {
    try {
      await sendSetupCode(
        {
          handle: user.handle,
          displayName: user.displayName,
          email: user.email,
        },
        token,
        expiresAt,
      );
      revalidatePath("/admin/roster");
      return { message: issuedMessage(user.handle, true) };
    } catch (error) {
      // The token is already minted, so falling back to showing it beats
      // stranding the administrator with a code they cannot see.
      console.error("[foi] 设置码邮件发送失败", error);
      return {
        message: `邮件发送失败（${error instanceof Error ? error.message : "未知错误"}），请手动转交下面的设置码。`,
        setupCode: token,
      };
    }
  }

  revalidatePath("/admin/roster");
  return {
    message: issuedMessage(user.handle, false),
    setupCode: token,
  };
}
