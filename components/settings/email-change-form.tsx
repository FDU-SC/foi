"use client";

import { useActionState } from "react";
import { FormMessage, PendingSubmit } from "@/components/form";
import { Field, Input } from "@/components/ui/field";
import { requestEmailChangeAction, type EmailChangeState } from "@/app/(site)/settings/email/actions";

export function EmailChangeForm() {
  const [state, formAction] = useActionState<EmailChangeState, FormData>(
    requestEmailChangeAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <Field label="新邮箱">
        <Input
          name="newEmail"
          type="email"
          autoComplete="email"
          required
          spellCheck={false}
          autoFocus
        />
      </Field>

      {state.error ? <FormMessage tone="err">{state.error}</FormMessage> : null}
      {state.message ? (
        <FormMessage tone="ok">{state.message}</FormMessage>
      ) : null}

      <PendingSubmit variant="primary" className="w-full" pendingLabel="发送中…">
        发送验证链接到新邮箱
      </PendingSubmit>
    </form>
  );
}
