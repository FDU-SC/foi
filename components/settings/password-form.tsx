"use client";

import { useActionState } from "react";
import { FormMessage, PendingSubmit } from "@/components/form";
import { Field, Input } from "@/components/ui/field";
import { changePasswordAction, type SettingsState } from "@/app/(site)/settings/actions";

export function PasswordForm({ minLength }: { minLength: number }) {
  const [state, formAction] = useActionState<SettingsState, FormData>(
    changePasswordAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <Field label="当前密码">
        <Input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Field label="新密码" hint={`至少 ${minLength} 位。`}>
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={minLength}
          required
        />
      </Field>
      <Field label="确认新密码">
        <Input
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={minLength}
          required
        />
      </Field>
      {/* Success is reported by the page after the post-change redirect, not here. */}
      {state.error ? <FormMessage tone="err">{state.error}</FormMessage> : null}
      <PendingSubmit variant="primary" pendingLabel="更新中…">
        更新密码
      </PendingSubmit>
    </form>
  );
}
