"use client";

import { useActionState } from "react";
import { ActionResult, PendingSubmit } from "@/components/form";
import {
  revokeRunnerTokenAction,
  type TokenActionState,
} from "@/app/(site)/admin/runners/actions";

export function RevokeTokenForm({
  keyId,
  label,
}: {
  keyId: string;
  label: string;
}) {
  const [state, formAction] = useActionState<TokenActionState, FormData>(
    revokeRunnerTokenAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="keyId" value={keyId} />
      <PendingSubmit
        variant="danger"
        size="sm"
        pendingLabel="处理中…"
        aria-label={`吊销令牌 ${label}`}
      >
        吊销
      </PendingSubmit>
      <ActionResult state={state} />
    </form>
  );
}
