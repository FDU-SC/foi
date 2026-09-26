"use client";

import { useActionState } from "react";
import { FormMessage, PendingSubmit } from "@/components/form";
import { Field, Textarea } from "@/components/ui/field";
import { updateBioAction, type SettingsState } from "@/app/(site)/settings/actions";
import { BIO_MAX_LENGTH } from "@/lib/accounts/types";

export function BioForm({ current }: { current: string | null }) {
  const [state, formAction] = useActionState<SettingsState, FormData>(
    updateBioAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <Field label="个人简介" hint={`显示在个人主页上，最多 ${BIO_MAX_LENGTH} 字，留空即清除。`}>
        <Textarea
          name="bio"
          defaultValue={current ?? ""}
          maxLength={BIO_MAX_LENGTH}
          rows={3}
          className="font-sans text-sm"
        />
      </Field>
      {state.error ? <FormMessage tone="err">{state.error}</FormMessage> : null}
      {state.message ? <FormMessage tone="ok">{state.message}</FormMessage> : null}
      <PendingSubmit variant="primary" pendingLabel="保存中…">
        保存简介
      </PendingSubmit>
    </form>
  );
}
