"use client";

import { useActionState } from "react";
import { ActionResult, PendingSubmit } from "@/components/form";
import { Input } from "@/components/ui/field";
import {
  reinstateAccountAction,
  suspendAccountAction,
  type ActionState,
} from "@/app/(site)/admin/actions";

export function ModerateForm({
  uid,
  username,
  suspended,
}: {
  uid: number;
  username: string;
  suspended: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    suspended ? reinstateAccountAction : suspendAccountAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="uid" value={uid} />
      {suspended ? (
        <PendingSubmit variant="secondary" size="sm" pendingLabel="处理中…">
          解封
        </PendingSubmit>
      ) : (
        <div className="flex items-center gap-1.5">
          <Input
            name="reason"
            placeholder="封禁原因"
            maxLength={200}
            className="h-8 w-32 py-0 text-xs"
            aria-label={`封禁 ${username} 的原因`}
          />
          <PendingSubmit variant="danger" size="sm" pendingLabel="处理中…">
            封禁
          </PendingSubmit>
        </div>
      )}
      <ActionResult state={state} />
    </form>
  );
}
