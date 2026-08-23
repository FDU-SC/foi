"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/auth";
import { resolveUser } from "@/lib/accounts/resolve";
import type { Capability } from "@/lib/auth/policy";
import { userCan } from "@/lib/auth/session";
import { issueToken } from "@/lib/auth/tokens";
import { syncContests } from "@/lib/contests/queries";
import { syncProblems } from "@/lib/problems/sync";

export interface ActionState {
  error?: string;
  message?: string;
  /** Shown once and never persisted in plaintext. */
  setupCode?: string;
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

  const { token } = await issueToken(user.handle, "setup_code");

  revalidatePath("/admin/roster");
  return {
    message: `已为 ${user.handle} 签发设置码，7 天内有效。`,
    setupCode: token,
  };
}
