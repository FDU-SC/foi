"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  registerAction,
  resendVerification,
  type RegisterState,
  type ResendState,
} from "./actions";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="primary"
      className="w-full"
      disabled={pending}
    >
      {pending ? "提交中…" : label}
    </Button>
  );
}

function ResendButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" className="w-full" disabled={pending}>
      {pending ? "发送中…" : "重新发送验证邮件"}
    </Button>
  );
}

/** Shown after the account exists; the only thing left is the mail round trip. */
function AwaitingVerification({
  email,
  warning,
}: {
  email: string;
  warning?: string;
}) {
  const [state, formAction] = useActionState<ResendState, FormData>(
    resendVerification,
    {},
  );

  return (
    <div className="space-y-4">
      <p className="text-ok bg-ok-subtle rounded-md px-3 py-2 text-sm leading-6">
        验证邮件已发送到 <span className="font-mono">{email}</span>
        。点击邮件里的链接即可完成注册。
      </p>

      {warning ? (
        <p className="text-err bg-err-subtle rounded-md px-3 py-2 text-sm leading-6">
          {warning}
        </p>
      ) : null}

      <p className="text-fg-subtle text-xs leading-relaxed">
        没收到？先看看垃圾邮件。验证链接 24 小时内有效，逾期未验证的用户名会被释放。
      </p>

      <form action={formAction} className="space-y-2">
        <input type="hidden" name="email" value={email} />
        <ResendButton />
        {state.message ? (
          <p className="text-fg-muted text-xs leading-5">{state.message}</p>
        ) : null}
        {state.error ? (
          <p className="text-err text-xs leading-5">{state.error}</p>
        ) : null}
      </form>

      <Link
        href="/login"
        className="text-fg-subtle hover:text-fg block text-center text-xs underline"
      >
        返回登录
      </Link>
    </div>
  );
}

export function RegisterForm() {
  const [state, formAction] = useActionState<RegisterState, FormData>(
    registerAction,
    {},
  );

  if (state.sentTo) {
    return <AwaitingVerification email={state.sentTo} warning={state.error} />;
  }

  return (
    <form action={formAction} className="space-y-4">
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

      <Field label="邮箱" hint="决定你所属的分组，请使用学校邮箱">
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          spellCheck={false}
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

      {state.error ? (
        <p className="text-err bg-err-subtle rounded-md px-3 py-2 text-sm leading-6">
          {state.error}
        </p>
      ) : null}

      <SubmitButton label="注册" />
    </form>
  );
}
