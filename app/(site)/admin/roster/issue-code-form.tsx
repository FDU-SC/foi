"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CopyButton } from "@/components/ui/copy-button";
import { Button } from "@/components/ui/button";
import { issueSetupCodeAction, type ActionState } from "../actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="secondary" disabled={pending}>
      {pending ? "签发中…" : label}
    </Button>
  );
}

/**
 * Issues a setup code for one handle and shows it exactly once.
 *
 * Only the digest is stored, so there is no second chance to read it — the
 * plaintext lives in this component's state and nowhere else.
 */
export function IssueCodeForm({
  handle,
  hasPassword,
}: {
  handle: string;
  hasPassword: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    issueSetupCodeAction,
    {},
  );

  return (
    <div className="flex flex-col items-end gap-1.5">
      <form action={formAction}>
        <input type="hidden" name="handle" value={handle} />
        <Submit label={hasPassword ? "重置密码" : "签发设置码"} />
      </form>

      {state.error ? (
        <span className="text-err text-xs">{state.error}</span>
      ) : null}

      {state.setupCode ? (
        <div className="border-ok/30 bg-ok-subtle w-full max-w-xs rounded-md border px-2.5 py-2 text-left">
          <div className="text-ok mb-1 text-[11px] leading-4">
            只显示这一次，请立即转交本人。
          </div>
          <div className="flex items-center gap-1.5">
            <code className="text-fg grow font-mono text-xs break-all">
              {state.setupCode}
            </code>
            <CopyButton value={state.setupCode} />
          </div>
          <div className="text-fg-subtle mt-1 text-[11px] leading-4">
            用它在 /setup 设置密码，7 天内有效。
          </div>
        </div>
      ) : null}
    </div>
  );
}
