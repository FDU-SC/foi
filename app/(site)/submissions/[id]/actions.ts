"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCapability } from "@/auth";
import { rateLimit } from "@/lib/ratelimit";
import { ACTION_LIMITS } from "@/lib/ratelimit/policy";
import {
  rejudgeSubmissions,
  submissionStateOf,
} from "@/lib/submissions/rejudge";
import { skipAcceptedFilter } from "@/content/_shared/submission-utils";

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
  const actor = await requireCapability("submission.rejudge");

  const rule = ACTION_LIMITS.rejudgeSubmissionAction;
  const limited = rateLimit(
    `rejudge:${actor.uid}`,
    rule.max,
    rule.windowSeconds * 1000,
  );
  if (!limited.ok) {
    return {
      error: `重判过于频繁，请 ${Math.ceil(limited.retryAfterMs / 60_000)} 分钟后再试。`,
    };
  }

  const parsed = rejudgeSchema.safeParse({
    id: formData.get("id"),
    includeAccepted: formData.get("includeAccepted") !== null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }

  const row = await submissionStateOf(parsed.data.id);
  if (!row) return { error: "提交不存在" };

  if (row.state === "pending") {
    return { error: "这条提交还没有评测完，不需要重判。" };
  }

  const skipFilter = parsed.data.includeAccepted
    ? undefined
    : skipAcceptedFilter;

  const result = await rejudgeSubmissions([parsed.data.id], {
    skipFilter,
  });

  if (result.skippedInline > 0) {
    return {
      error:
        "这道题由内核自己判定，没有评测机会来领取——重新提交一次即可，重判对它没有意义。",
    };
  }

  if (result.skippedNotDispatched > 0) {
    return {
      error:
        "题库里这道题已经不再交给评测机了——改成了内核内联判题，或是整道题已经不在题库中。放回队列只会让评测机白领三次再中断一次，请让选手重新提交。",
    };
  }

  if (result.skippedByFilter > 0) {
    return {
      error:
        "这条提交已经通过，默认不重判。确实要覆盖它的结果，请勾选「连已通过的一起重判」。",
    };
  }

  if (result.requeued === 0) {

    revalidatePath(`/submissions/${parsed.data.id}`);
    return { error: "这条提交的状态刚刚变了，没有改动任何东西，请刷新后再看。" };
  }

  revalidatePath(`/submissions/${parsed.data.id}`);
  return { message: "已重新排队，评测机领取后会重新评测。" };
}
