"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PendingSubmit({
  pendingLabel,
  children,
  ...props
}: Omit<ButtonProps, "pending"> & { pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" pending={pending} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

const TONES = {
  ok: "text-ok border-ok",
  err: "text-err border-err",
} as const;

export function FormMessage({
  tone,
  children,
}: {
  tone: keyof typeof TONES;
  children: ReactNode;
}) {
  return (
    <p className={cn("border-l-2 py-0.5 pl-3 text-sm leading-6", TONES[tone])}>
      {children}
    </p>
  );
}

export function ActionResult({
  state,
  className,
}: {
  state: { error?: string; message?: string };
  className?: string;
}) {
  return (
    <>
      {state.error ? (
        <span className={cn("text-err text-xs", className)}>{state.error}</span>
      ) : null}
      {state.message ? (
        <span className={cn("text-ok text-xs", className)}>{state.message}</span>
      ) : null}
    </>
  );
}
