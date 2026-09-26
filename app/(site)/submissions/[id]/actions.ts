"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/auth";
import { authorize } from "@/lib/authz/engine";
import { rateLimit } from "@/lib/ratelimit";
import { ACTION_LIMITS } from "@/lib/ratelimit/policy";
import { parseInput } from "@/lib/validation";
import {
  rejudgeSubmissions,
  submissionStateOf,
} from "@/lib/submissions/rejudge";
import type { RejudgeSkipFilter } from "@/lib/submissions/rejudge";

// Convention: backends set result.accepted = true for passing submissions.
const skipAcceptedFilter: RejudgeSkipFilter = (row) =>
  row.state === "completed" &&
  (row.result as { accepted?: boolean } | null)?.accepted === true;

export interface ActionState {
  error?: string;
  message?: string;
}

const rejudgeSchema = z.object({
  id: z.string().min(1, "缺少提交 id"),

  includeAccepted: z.boolean(),
});

export async function rejudgeSubmissionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await getViewer();

  const rule = ACTION_LIMITS.rejudgeSubmissionAction;
  const limited = rateLimit(`rejudge:${actor.uid}`, rule);
  if (!limited.ok) {
    return {
      error: `重判过于频繁，请 ${Math.ceil(limited.retryAfterMs / 60_000)} 分钟后再试。`,
    };
  }

  const parsed = parseInput(rejudgeSchema, {
    id: formData.get("id"),
    includeAccepted: formData.get("includeAccepted") !== null,
  });
  if (!parsed.ok) return { error: parsed.error };

  const row = await submissionStateOf(parsed.data.id);
  if (!row) return { error: "提交不存在" };

  const decision = authorize("submission.rejudge", row, actor);
  if (!decision.allow) return { error: decision.reason.message };

  if (row.state === "pending") {
    return { error: "评测尚未完成。" };
  }

  const skipFilter = parsed.data.includeAccepted
    ? undefined
    : skipAcceptedFilter;

  const result = await rejudgeSubmissions([parsed.data.id], {
    skipFilter,
  });

  if (result.skippedInline > 0) {
    return {
      error: "这道题无法重判。",
    };
  }

  if (result.skippedNotDispatched > 0) {
    return {
      error: "这道题无法重判。",
    };
  }

  if (result.skippedByFilter > 0) {
    return {
      error: "该提交已通过。",
    };
  }

  if (result.requeued === 0) {
    revalidatePath(`/submissions/${parsed.data.id}`);
    return { error: "提交状态已变更。" };
  }

  revalidatePath(`/submissions/${parsed.data.id}`);
  return { message: "已重新排队，等待评测。" };
}
