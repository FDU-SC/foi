"use client";

import { useActionState } from "react";
import { ActionResult, PendingSubmit } from "@/components/form";
import { resendPasswordResetAction, type ActionState } from "./actions";

/**
 * Mails a password reset to one account.
 *
 * There is deliberately nothing to copy here. The predecessor of this button
 * printed a setup code on screen for an administrator to relay by hand; the
 * link now goes to the account's own inbox, so the only feedback needed is
 * whether it went out.
 */
export function ResendResetForm({
  handle,
  hasPassword,
}: {
  handle: string;
  hasPassword: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    resendPasswordResetAction,
    {},
  );

  return (
    <div className="flex flex-col items-end gap-1.5">
      <form action={formAction}>
        <input type="hidden" name="handle" value={handle} />
        <PendingSubmit size="sm" variant="secondary" pendingLabel="发送中…">
          {hasPassword ? "发送重置邮件" : "发送设置密码邮件"}
        </PendingSubmit>
      </form>

      <ActionResult state={state} className="max-w-xs text-right leading-4" />
    </div>
  );
}
