"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormMessage, PendingSubmit } from "@/components/form";
import { Field, Input } from "@/components/ui/field";
import { requestPasswordReset, type ForgotState } from "@/app/forgot-password/actions";

export function ForgotForm() {
  const [state, formAction] = useActionState<ForgotState, FormData>(
    requestPasswordReset,
    {},
  );

  if (state.message) {
    return (
      <div className="space-y-4">
        <FormMessage tone="ok">{state.message}</FormMessage>
        <Link
          href="/login"
          className="border-border text-fg hover:bg-surface-2 block rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors"
        >
          返回登录
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <Field label="用户名或邮箱">
        <Input
          name="identifier"
          autoComplete="username"
          autoFocus
          required
          spellCheck={false}
        />
      </Field>

      {state.error ? <FormMessage tone="err">{state.error}</FormMessage> : null}

      <PendingSubmit
        variant="primary"
        className="w-full"
        pendingLabel="发送中…"
      >
        发送重置链接
      </PendingSubmit>
    </form>
  );
}
