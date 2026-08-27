"use client";

import { useActionState } from "react";
import { ActionResult, PendingSubmit } from "@/components/form";
import { rejudgeSubmissionAction, type ActionState } from "./actions";

export function RejudgeForm({ id }: { id: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    rejudgeSubmissionAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <PendingSubmit variant="secondary" size="sm" pendingLabel="处理中…">
        重新评测
      </PendingSubmit>
      <label className="text-fg-muted flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          name="includeAccepted"
          className="accent-primary size-3.5"
        />
        连已通过的一起重判
      </label>
      <ActionResult state={state} />
    </form>
  );
}
