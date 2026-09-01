import { cn } from "@/lib/utils";

/**
 * A steady dot with a ring expanding away from it: "this is still happening".
 *
 * The dot stays put so it still reads as a status light; only the ring moves.
 * Colour defaults to `bg-current`, which picks up whatever the surrounding text
 * colour is, and the animation is CSS so nothing here needs client JavaScript.
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
