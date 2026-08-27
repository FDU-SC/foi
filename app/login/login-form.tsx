"use client";

import { useActionState } from "react";
import { FormMessage, PendingSubmit } from "@/components/form";
import { Field, Input } from "@/components/ui/field";
import { login, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <Field label="用户名或邮箱">
        <Input
          name="identifier"
          autoComplete="username"
          autoFocus
          required
          spellCheck={false}
        />
      </Field>

      <Field label="密码">
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>

      {state.error ? <FormMessage tone="err">{state.error}</FormMessage> : null}

      <PendingSubmit
        variant="primary"
        className="w-full"
        pendingLabel="登录中…"
      >
        登录
      </PendingSubmit>
    </form>
  );
}
