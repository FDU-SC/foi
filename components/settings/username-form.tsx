"use client";

import { useActionState } from "react";
import { FormMessage, PendingSubmit } from "@/components/form";
import { Field, Input } from "@/components/ui/field";
import { updateUsernameAction, type SettingsState } from "@/app/(site)/settings/actions";

export function UsernameForm({
  current,
  hint,
}: {
  current: string;
  hint: string;
}) {
  const [state, formAction] = useActionState<SettingsState, FormData>(
    updateUsernameAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <Field label="用户名" hint={hint}>
        <Input
          name="username"
          defaultValue={current}
          minLength={2}
          maxLength={32}
          pattern="[a-zA-Z0-9_\-]+"
          required
          spellCheck={false}
          autoComplete="username"
          className="font-mono"
        />
      </Field>
      <Field label="当前密码">
        <Input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      {state.error ? <FormMessage tone="err">{state.error}</FormMessage> : null}
      {state.message ? <FormMessage tone="ok">{state.message}</FormMessage> : null}
      <PendingSubmit variant="primary" pendingLabel="保存中…">
        保存用户名
      </PendingSubmit>
    </form>
  );
}
