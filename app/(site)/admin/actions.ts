"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/auth";
import { issueSetupCode } from "@/lib/auth/credentials";
import type { Capability } from "@/lib/auth/policy";
import { userCan } from "@/lib/auth/session";
import { syncContests } from "@/lib/contests/queries";
import { syncProblems } from "@/lib/problems/sync";
import { getMember } from "@/lib/roster/registry";

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
 * The one write an administrator still has, because a password is the one
 * thing the repository cannot hold. Everything else on this console — who
 * exists, what they may do, which problems are in which contest — is a pull
 * request against `content/`.
 *
 * The handle must be in the roster: issuing a code for someone the roster
 * does not know would create a credentials row that can never be used.
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

  const member = getMember(parsed.data.handle);
  if (!member) {
    return { error: "该用户名不在名册中，请先在 content/roster/ 中登记" };
  }
  if (member.disabled) {
    return { error: "该用户已在名册中停用，无法签发设置码" };
  }

  const { code } = await issueSetupCode(member.handle);

  revalidatePath("/admin/credentials");
  return {
    message: `已为 ${member.handle} 签发设置码，7 天内有效。`,
    setupCode: code,
  };
}
