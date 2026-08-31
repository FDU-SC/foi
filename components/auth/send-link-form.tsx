"use client";

import { useState, useTransition } from "react";
import { FormMessage } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { sendVerificationLinkAction } from "@/app/register/actions";

export function SendLinkForm({ invalidToken }: { invalidToken?: boolean }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | undefined>(
    invalidToken ? "验证链接无效或已过期，请重新获取。" : undefined,
  );
  const [busy, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await sendVerificationLinkAction(email);
      if (result.error) {
        setError(result.error);
        setSent(false);
      } else {
        setError(undefined);
        setSent(true);
      }
    });
  }

  return (
    <div className="space-y-4">
      <Field label="邮箱" hint="决定你所属的分组，请使用学校邮箱">
        <Input
          type="email"
          autoComplete="email"
          autoFocus
          required
          spellCheck={false}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (sent) setSent(false);
          }}
        />
      </Field>

      {error ? <FormMessage tone="err">{error}</FormMessage> : null}

      {sent ? (
        <FormMessage tone="ok">
          验证链接已发送到你的邮箱，请查收并点击链接继续注册。没收到请先看看垃圾邮件。
        </FormMessage>
      ) : null}

      <Button
        type="button"
        variant="primary"
        className="w-full"
        disabled={busy || email.trim().length === 0}
        onClick={submit}
      >
        {busy ? "发送中…" : sent ? "重新发送" : "发送验证链接"}
      </Button>
    </div>
  );
}
