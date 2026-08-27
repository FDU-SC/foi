"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormMessage, PendingSubmit } from "@/components/form";
import { Field, Input } from "@/components/ui/field";
import { registerAction, type RegisterState } from "./actions";

function NeedsLogin() {
  return (
    <div className="space-y-4">
      <FormMessage tone="ok">
        账号已创建。自动登录没有成功，请手动登录一次。
      </FormMessage>
      <Link
        href="/login"
        className="bg-primary text-primary-fg hover:bg-primary-hover block rounded-md px-3 py-2 text-center text-sm font-medium transition-colors"
      >
        前往登录
      </Link>
    </div>
  );
}

export function RegisterForm({
  email,
  token,
}: {
  email: string;
  token: string;
}) {
  const [state, formAction] = useActionState<RegisterState, FormData>(
    registerAction,
    {},
  );

  if (state.createdNeedsLogin) return <NeedsLogin />;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <FormMessage tone="ok">
        邮箱已验证，请填写以下信息完成注册。
      </FormMessage>

      <Field label="用户名" hint="2-32 位字母、数字、下划线或连字符，注册后不可更改">
        <Input
          name="handle"
          autoComplete="username"
          autoFocus
          required
          minLength={2}
          maxLength={32}
          pattern="[A-Za-z0-9_\-]+"
          spellCheck={false}
        />
      </Field>

      <Field label="显示名" hint="排行榜上展示的名字">
        <Input name="displayName" autoComplete="name" required maxLength={64} />
      </Field>

      <Field label="邮箱">
        <Input
          name="email"
          type="email"
          value={email}
          readOnly
          className="text-fg-muted"
        />
      </Field>

      <Field label="密码" hint="至少 8 位">
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

      {state.error ? <FormMessage tone="err">{state.error}</FormMessage> : null}

      <PendingSubmit
        variant="primary"
        className="w-full"
        pendingLabel="注册中…"
      >
        注册
      </PendingSubmit>
    </form>
  );
}
