"use client";

import { useActionState, useState } from "react";
import { ActionResult, PendingSubmit } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import {
  issueRunnerTokenAction,
  type TokenActionState,
} from "@/app/(site)/admin/runners/actions";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button type="button" size="sm" variant="secondary" onClick={copy}>
      {copied === null ? "复制" : copied ? "已复制" : "复制失败，请手动选取"}
    </Button>
  );
}

export function IssueTokenForm({ backendIds }: { backendIds: string[] }) {
  const [state, formAction] = useActionState<TokenActionState, FormData>(
    issueRunnerTokenAction,
    {},
  );

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <Field label="评测后端">
          <Select name="backendId" className="block w-48 font-mono" required>
            {backendIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="备注">
          <Input
            name="label"
            placeholder="例如宿主名"
            maxLength={64}
            required
            className="block w-56"
          />
        </Field>
        <PendingSubmit variant="primary" pendingLabel="签发中…">
          签发
        </PendingSubmit>
      </form>

      {state.token ? (
        <div className="border-ok space-y-1.5 border-l-2 pl-3">
          <p className="text-fg text-sm">
            {state.message} 令牌只显示这一次，离开页面后无法再查看。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="bg-surface-2 text-fg rounded-sm px-2 py-1 font-mono text-xs break-all select-all">
              {state.token}
            </code>
            <CopyButton key={state.token} value={state.token} />
          </div>
        </div>
      ) : (
        <ActionResult state={state} />
      )}
    </div>
  );
}
