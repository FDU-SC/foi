"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCapability } from "@/auth";
import { rateLimit } from "@/lib/ratelimit";
import { ACTION_LIMITS } from "@/lib/ratelimit/policy";
import { rejudgeSubmissions, submissionStateOf } from "@/lib/submissions/rejudge";

export interface ActionState {
  error?: string;
  message?: string;
}

const rejudgeSchema = z.object({
  id: z.string().min(1, "缺少提交 id"),
  /**
   * A checkbox, so it arrives as `"on"` or not at all. Read as a presence test
   * rather than parsed, because the default has to be "no" for anything the
   * form did not send — including a form posted by something that is not this
   * page.
   */
  includeAccepted: z.boolean(),
});

/**
 * Sends one submission back to the queue — the whole of the administrative
 * side of judging, and deliberately so: no cancel, no pinning to a runner, no
 * internal-error console.
 *
 * Bulk rejudge is the obvious next thing and is not here on purpose: the
 * accepted-submissions default below matters far more when the operation
 * covers a whole round, so it needs its own confirmation rather than this
 * checkbox.
 */
export async function rejudgeSubmissionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCapability("submission.rejudge");

  // The one privileged action here whose cost lands on somebody else's machine:
  // every press puts real work back on a runner. Sized well above an operator
  // clearing up after a bad round and well below anything that could occupy the
  // pool.
  const rule = ACTION_LIMITS.rejudgeSubmissionAction;
  const limited = rateLimit(
    `rejudge:${actor.handle}`,
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

  // Answered before the write rather than inferred from a zero count, because
  // the three ways this does nothing call for three different sentences and a
  // count of zero cannot tell them apart.
  if (row.state === "queued" || row.state === "judging") {
    return { error: "这条提交还没有评测完，不需要重判。" };
  }

  const result = await rejudgeSubmissions([parsed.data.id], {
    includeAccepted: parsed.data.includeAccepted,
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

  if (result.keptAccepted > 0) {
    return {
      error:
        "这条提交已经通过，默认不重判。确实要覆盖它的结果，请勾选「连已通过的一起重判」。",
    };
  }

  if (result.requeued === 0) {
    // The row moved between the read above and the write. Nothing failed and
    // nothing is wrong — the state it is in now is the answer.
    revalidatePath(`/submissions/${parsed.data.id}`);
    return { error: "这条提交的状态刚刚变了，没有改动任何东西，请刷新后再看。" };
  }

  revalidatePath(`/submissions/${parsed.data.id}`);
  return { message: "已重新排队，评测机领取后会重新评测。" };
}
