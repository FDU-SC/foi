"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import {
  reinstateAccountAction,
  suspendAccountAction,
  type ActionState,
} from "./actions";

function SubmitButton({
  label,
  variant,
}: {
  label: string;
  variant: "danger" | "secondary";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size="sm" disabled={pending}>
      {pending ? "处理中…" : label}
    </Button>
  );
}

/**
 * Suspending asks for a reason inline rather than behind a dialog. The reason
 * is written to the row and is the only record of why somebody was locked out,
 * so the field being unavoidable is the point.
 */
export function ModerateForm({
  handle,
  suspended,
}: {
  handle: string;
  suspended: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    suspended ? reinstateAccountAction : suspendAccountAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="handle" value={handle} />
      {suspended ? (
        <SubmitButton label="解封" variant="secondary" />
      ) : (
        <div className="flex items-center gap-1.5">
          <Input
            name="reason"
            placeholder="封禁原因"
            maxLength={200}
            className="h-8 w-32 py-0 text-xs"
            aria-label={`封禁 ${handle} 的原因`}
          />
          <SubmitButton label="封禁" variant="danger" />
        </div>
      )}
      {state.error ? (
        <span className="text-err text-xs">{state.error}</span>
      ) : null}
      {state.message ? (
        <span className="text-ok text-xs">{state.message}</span>
      ) : null}
    </form>
  );
}
