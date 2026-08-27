"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { FormMessage, PendingSubmit } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  registerAction,
  sendCodeAction,
  verifyCodeAction,
  type RegisterState,
} from "./actions";

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

type Phase = "idle" | "sent" | "verified";

export function RegisterForm({
  codeTtlMinutes,
  resendCooldownMs,
}: {
  codeTtlMinutes: number;
  resendCooldownMs: number;
}) {
  const [state, formAction] = useActionState<RegisterState, FormData>(
    registerAction,
    {},
  );

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string }>();
  const [cooldown, setCooldown] = useState(0);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const resendSeconds = Math.ceil(resendCooldownMs / 1000);

  if (state.createdNeedsLogin) return <NeedsLogin />;

  function send() {
    startTransition(async () => {
      const result = await sendCodeAction(email);
      if (result.error) {
        setNotice({ tone: "err", text: result.error });
        return;
      }
      setPhase("sent");
      setCode("");
      setCooldown(resendSeconds);
      setNotice({
        tone: "ok",
        text: `验证码已发送，${codeTtlMinutes} 分钟内有效。没收到请先看看垃圾邮件。`,
      });
    });
  }

  function verify() {
    startTransition(async () => {
      const result = await verifyCodeAction(email, code);
      if (result.verified) {
        setPhase("verified");
        setNotice(undefined);
      } else {
        setNotice({ tone: "err", text: result.error ?? "验证失败" });
      }
    });
  }

  function changeEmail(next: string) {
    setEmail(next);
    if (phase !== "idle") {
      setPhase("idle");
      setCode("");
      setNotice(undefined);
    }
  }

  const verified = phase === "verified";

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

      <div className="space-y-1.5">
        <label
          htmlFor="register-email"
          className="text-fg-muted block text-xs font-medium"
        >
          邮箱
        </label>
        <div className="flex gap-2">
          <Input
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            spellCheck={false}
            readOnly={verified}
            className="min-w-0 flex-1"
            value={email}
            onChange={(event) => changeEmail(event.target.value)}
          />
          {verified ? (
            <Button
              type="button"
              variant="ghost"
              className="w-28 shrink-0"
              onClick={() => changeEmail("")}
            >
              换个邮箱
            </Button>
          ) : (
            <Button
              type="button"
              className="w-28 shrink-0"
              disabled={busy || cooldown > 0 || email.trim().length === 0}
              onClick={send}
            >
              {cooldown > 0
                ? `${cooldown} 秒后重发`
                : phase === "sent"
                  ? "重新发送"
                  : "获取验证码"}
            </Button>
          )}
        </div>
        <span className="text-fg-subtle block text-xs">
          决定你所属的分组，请使用学校邮箱
        </span>
      </div>

      {verified ? (
        <FormMessage tone="ok">邮箱已验证，可以完成注册了。</FormMessage>
      ) : null}

      {!verified && phase === "sent" ? (
        <div className="space-y-1.5">
          <label
            htmlFor="register-code"
            className="text-fg-muted block text-xs font-medium"
          >
            邮箱验证码
          </label>
          <div className="flex gap-2">
            <Input
              id="register-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              spellCheck={false}
              placeholder="6 位数字"
              className="min-w-0 flex-1 font-mono tracking-[0.3em]"
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
            />
            <Button
              type="button"
              variant="primary"
              className="w-28 shrink-0"
              disabled={busy || code.length !== 6}
              onClick={verify}
            >
              {busy ? "验证中…" : "验证"}
            </Button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p
          className={
            notice.tone === "ok"
              ? "text-fg-muted bg-surface-2 rounded-md px-3 py-2 text-sm leading-6"
              : "text-err bg-err-subtle rounded-md px-3 py-2 text-sm leading-6"
          }
        >
          {notice.text}
        </p>
      ) : null}

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
        disabled={!verified}
      >
        注册
      </PendingSubmit>
    </form>
  );
}
