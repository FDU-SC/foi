"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormMessage, PendingSubmit } from "@/components/form";
import { Field, Input } from "@/components/ui/field";
import { resetPasswordAction, type ResetState } from "@/app/reset-password/actions";

export function ResetForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<ResetState, FormData>(
    resetPasswordAction,
    {},
  );

  if (state.message) {
    return (
      <div className="space-y-4">
        <FormMessage tone="ok">{state.message}</FormMessage>
        <Link
          href="/login"
          className="bg-primary text-primary-fg hover:bg-primary-hover block rounded-md px-3 py-2 text-center text-sm font-medium transition-colors"
        >
          前往登录
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <Field label="新密码" hint="至少 8 位">
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          autoFocus
          required
        />
      </Field>

      <Field label="确认密码">
        <Input
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </Field>

      {state.error ? <FormMessage tone="err">{state.error}</FormMessage> : null}

      <PendingSubmit
        variant="primary"
        className="w-full"
        pendingLabel="设置中…"
      >
        设置新密码
      </PendingSubmit>
    </form>
  );
}
