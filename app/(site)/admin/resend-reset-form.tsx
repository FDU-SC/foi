"use client";

import { useActionState } from "react";
import { ActionResult, PendingSubmit } from "@/components/form";
import { resendPasswordResetAction, type ActionState } from "./actions";

export function ResendResetForm({
  uid,
  hasPassword,
}: {
  uid: number;
  hasPassword: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    resendPasswordResetAction,
    {},
  );

  return (
    <div className="flex flex-col items-end gap-1.5">
      <form action={formAction}>
        <input type="hidden" name="uid" value={uid} />
        <PendingSubmit size="sm" variant="secondary" pendingLabel="发送中…">
          {hasPassword ? "发送重置邮件" : "发送设置密码邮件"}
        </PendingSubmit>
      </form>

      <ActionResult state={state} className="max-w-xs text-right leading-4" />
    </div>
  );
}
