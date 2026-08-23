"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { resetPasswordAction, type ResetState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="primary"
      className="w-full"
      disabled={pending}
    >
      {pending ? "设置中…" : "设置新密码"}
    </Button>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<ResetState, FormData>(
    resetPasswordAction,
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

      {state.error ? (
        <p className="text-err bg-err-subtle rounded-md px-3 py-2 text-sm leading-6">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
