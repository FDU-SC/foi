"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { redeemSetupCodeAction, type SetupState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="primary"
      className="w-full"
      disabled={pending}
    >
      {pending ? "设置中…" : "设置密码"}
    </Button>
  );
}

export function SetupForm({
  handle,
  code,
}: {
  handle: string;
  code: string;
}) {
  const [state, formAction] = useActionState<SetupState, FormData>(
    redeemSetupCodeAction,
    {},
  );

  if (state.message) {
    return (
      <div className="space-y-4">
        <p className="text-ok bg-ok-subtle rounded-md px-3 py-2 text-sm">
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
      <Field label="用户名">
        <Input
          name="handle"
          defaultValue={handle}
          autoComplete="username"
          autoFocus={!handle}
          required
          spellCheck={false}
        />
      </Field>

      <Field label="设置码" hint="由管理员一次性签发">
        <Input
          name="code"
          defaultValue={code}
          autoFocus={Boolean(handle) && !code}
          required
          spellCheck={false}
        />
      </Field>

      <Field label="新密码" hint="至少 8 位">
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
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
        <p className="text-err bg-err-subtle rounded-md px-3 py-2 text-sm">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
