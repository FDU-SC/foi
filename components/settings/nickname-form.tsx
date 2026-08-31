"use client";

import { useActionState } from "react";
import { FormMessage, PendingSubmit } from "@/components/form";
import { Field, Input } from "@/components/ui/field";
import { updateNicknameAction, type SettingsState } from "@/app/(site)/settings/actions";

export function NicknameForm({ current }: { current: string }) {
  const [state, formAction] = useActionState<SettingsState, FormData>(
    updateNicknameAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <Field label="昵称" hint="显示在排行榜和提交记录里，可以随时修改。">
        <Input
          name="nickname"
          defaultValue={current}
          maxLength={64}
          required
          autoComplete="nickname"
        />
      </Field>
      {state.error ? <FormMessage tone="err">{state.error}</FormMessage> : null}
      {state.message ? <FormMessage tone="ok">{state.message}</FormMessage> : null}
      <PendingSubmit variant="primary" pendingLabel="保存中…">
        保存昵称
      </PendingSubmit>
    </form>
  );
}
