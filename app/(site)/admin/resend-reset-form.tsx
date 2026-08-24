"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { resendPasswordResetAction, type ActionState } from "./actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="secondary" disabled={pending}>
      {pending ? "发送中…" : label}
    </Button>
  );
}

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
        <Submit label={hasPassword ? "发送重置邮件" : "发送设置密码邮件"} />
      </form>

      {state.error ? (
        <span className="text-err max-w-xs text-right text-xs leading-4">
          {state.error}
        </span>
      ) : null}

      {state.message ? (
        <span className="text-ok max-w-xs text-right text-xs leading-4">
          {state.message}
        </span>
      ) : null}
    </div>
  );
}
