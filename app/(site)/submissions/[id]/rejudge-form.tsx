"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { rejudgeSubmissionAction, type ActionState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" disabled={pending}>
      {pending ? "处理中…" : "重新评测"}
    </Button>
  );
}

/**
 * The opt-in is a checkbox rather than a second button, because the thing being
 * confirmed is a consequence rather than an alternative action: rejudging a
 * passing submission may take the pass away, and the operator should have to
 * say they know that before the one button they were going to press does it.
 *
 * Rendered only for a row that is finished and not inline — the page decides
 * that, so a button that cannot do anything is never drawn.
 */
export function RejudgeForm({ id }: { id: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    rejudgeSubmissionAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <SubmitButton />
      <label className="text-fg-muted flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          name="includeAccepted"
          className="accent-primary size-3.5"
        />
        连已通过的一起重判
      </label>
      {state.error ? (
        <span className="text-err text-xs">{state.error}</span>
      ) : null}
      {state.message ? (
        <span className="text-ok text-xs">{state.message}</span>
      ) : null}
    </form>
  );
}
