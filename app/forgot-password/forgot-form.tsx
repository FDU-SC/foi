"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { requestPasswordReset, type ForgotState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="primary"
      className="w-full"
      disabled={pending}
    >
      {pending ? "发送中…" : "发送重置链接"}
    </Button>
  );
}

export function ForgotForm() {
  const [state, formAction] = useActionState<ForgotState, FormData>(
    requestPasswordReset,
    {},
  );

  if (state.message) {
    return (
      <div className="space-y-4">
        <p className="text-ok bg-ok-subtle rounded-md px-3 py-2 text-sm leading-6">
          {state.message}
        </p>
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

      {state.error ? (
        <p className="text-err bg-err-subtle rounded-md px-3 py-2 text-sm">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
