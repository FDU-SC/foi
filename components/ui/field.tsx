import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

const CONTROL =
  "w-full rounded-sm border border-border bg-surface px-2.5 text-sm text-fg " +
  "placeholder:text-fg-subtle transition-colors " +
  "hover:border-border-strong focus:border-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, "h-8", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(CONTROL, "resize-y py-2 font-mono text-[13px]", className)}
      {...props}
    />
  );
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(CONTROL, "h-8", className)} {...props} />;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-fg-muted text-xs font-medium">{label}</span>
      {children}
      {hint ? (
        <span className="text-fg-subtle block text-xs">{hint}</span>
      ) : null}
    </label>
  );
}
