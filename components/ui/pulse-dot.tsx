import { cn } from "@/lib/utils";

/**
 * Status dot beside a label for background work (judging, auto refresh,
 * runners online). Defaults to `bg-current` to take the text colour.
 */
export function PulseDot({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full bg-current", className)} />
  );
}
