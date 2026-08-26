"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The three pieces every form built on a server action repeats.
 *
 * Not a form component: the forms themselves stay beside their pages and their
 * `actions.ts`, because what they ask for genuinely differs — a three-phase
 * email verification, a suspension reason, a checkbox that widens what a
 * rejudge touches. What does not differ is that a submit button has to read
 * `useFormStatus` to know it is in flight, and that whatever the action
 * answered has to be drawn somewhere.
 */

/**
 * A submit button that says what it is doing while the action runs.
 *
 * `useFormStatus` only reports the pending state of the `<form>` above it, so
 * this has to be its own component rather than a branch inside the form — a
 * hook called in the form's own body would read `false` forever.
 */
export function PendingSubmit({
  pendingLabel,
  children,
  disabled,
  ...props
}: ButtonProps & { pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

const TONES = {
  ok: "text-ok bg-ok-subtle",
  err: "text-err bg-err-subtle",
} as const;

/** What a full-page form shows above its button once the action has answered. */
export function FormMessage({
  tone,
  children,
}: {
  tone: keyof typeof TONES;
  children: ReactNode;
}) {
  return (
    <p className={cn("rounded-md px-3 py-2 text-sm leading-6", TONES[tone])}>
      {children}
    </p>
  );
}

/**
 * The same answer for a control that sits inline in a table row, where a boxed
 * paragraph would push the row around.
 */
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
        <span className={cn("text-ok text-xs", className)}>
          {state.message}
        </span>
      ) : null}
    </>
  );
}
