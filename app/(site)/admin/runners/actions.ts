"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/auth";
import { authorize } from "@/lib/authz/engine";
import { listBackendIds } from "@/lib/backend/registry";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/ratelimit";
import { ACTION_LIMITS } from "@/lib/ratelimit/policy";
import {
  findRunnerToken,
  isKeyId,
  issueRunnerToken,
  revokeRunnerToken,
} from "@/lib/runner/tokens";
import { parseInput } from "@/lib/validation";

export interface TokenActionState {
  error?: string;
  message?: string;
  /** The full token. Returned once, by the action that issued it. */
  token?: string;
}

const issueSchema = z.object({
  backendId: z.string("请选择评测后端").min(1, "请选择评测后端"),
  label: z
    .string("请填写备注")
    .trim()
    .min(1, "请填写备注")
    .max(64, "备注最多 64 个字"),
});

export async function issueRunnerTokenAction(
  _prev: TokenActionState,
  formData: FormData,
): Promise<TokenActionState> {
  const actor = await getViewer();

  const limited = await rateLimit(
    `runner-token:${actor.uid}`,
    ACTION_LIMITS.issueRunnerTokenAction,
  );
  if (!limited.ok) {
    return {
      error: `签发过于频繁，请 ${Math.ceil(limited.retryAfterMs / 60_000)} 分钟后再试。`,
    };
  }

  const parsed = parseInput(issueSchema, {
    backendId: formData.get("backendId"),
    label: formData.get("label"),
  });
  if (!parsed.ok) return { error: parsed.error };
  const { backendId, label } = parsed.data;

  if (!listBackendIds().includes(backendId)) {
    return { error: "没有这个评测后端" };
  }

  const decision = authorize("backend.manageTokens", { id: backendId }, actor);
  if (!decision.allow) return { error: decision.reason.message };

  const { token, row } = await issueRunnerToken({
    backendId,
    label,
    createdBy: actor.uid ?? 0,
  });
  log.info({ backendId, keyId: row.keyId, uid: actor.uid }, "已签发评测机令牌");

  revalidatePath("/admin/runners");
  return { token, message: `已为 ${backendId} 签发令牌「${label}」。` };
}

export async function revokeRunnerTokenAction(
  _prev: TokenActionState,
  formData: FormData,
): Promise<TokenActionState> {
  const actor = await getViewer();

  const keyId = formData.get("keyId");
  if (typeof keyId !== "string" || !isKeyId(keyId)) {
    return { error: "没有这个令牌" };
  }

  const token = await findRunnerToken(keyId);
  if (!token) return { error: "没有这个令牌" };

  const decision = authorize(
    "backend.manageTokens",
    { id: token.backendId },
    actor,
  );
  if (!decision.allow) return { error: decision.reason.message };

  const revoked = await revokeRunnerToken(keyId, actor.uid ?? 0);
  revalidatePath("/admin/runners");
  if (!revoked) return { error: `令牌「${token.label}」已经吊销。` };

  log.info(
    { backendId: token.backendId, keyId, uid: actor.uid },
    "已吊销评测机令牌",
  );
  return { message: `已吊销令牌「${token.label}」。` };
}
