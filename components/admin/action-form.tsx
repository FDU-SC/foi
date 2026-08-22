"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/app/(site)/admin/actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="sm" disabled={pending}>
      {pending ? "处理中…" : label}
    </Button>
  );
}

export function ActionForm({
  action,
  submitLabel,
  children,
  className,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  children?: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});

  return (
    <form action={formAction} className={className}>
      {children}
      <div className="mt-3 flex items-center gap-3">
        <Submit label={submitLabel} />
        {state.error ? (
          <span className="text-err text-xs">{state.error}</span>
        ) : null}
        {state.message ? (
          <span className="text-ok text-xs">{state.message}</span>
        ) : null}
      </div>
    </form>
  );
}
