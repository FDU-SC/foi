import { cn } from "@/lib/utils";

/**
 * CSS status indicator with a stationary dot and expanding ring.
 * Defaults to `bg-current` to inherit the surrounding text colour.
 */
export function PulseDot({
  active = true,
  className,
}: {
  active?: boolean;
  className?: string;
}) {
  const dot = cn("col-start-1 row-start-1 size-1.5 rounded-full", className);

  return (
    <span className="relative inline-grid size-1.5 place-items-center">
      {active ? (
        <span className={cn(dot, "motion-safe:animate-pulse-ring")} />
      ) : null}
      <span className={dot} />
    </span>
  );
}
