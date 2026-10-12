import type { PublicProblemConfig } from "@/lib/problems/types";
import type { ProblemFacet } from "@/lib/problems/views";
import { cn } from "@/lib/utils";

/** The dimension drawn as a ladder. Everything else reads as plain labels. */
const LADDER = "difficulty";

/** A value's rung on its dimension's order, one bar per rung; no bars off the ladder. */
function Ladder({ value, order }: { value: string; order?: string[] }) {
  const rung = order ? order.indexOf(value) + 1 : 0;
  return (
    <span className="text-fg inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap">
      {order && rung > 0 ? (
        <span aria-hidden className="inline-flex gap-0.5">
          {order.map((step, index) => (
            <span key={step} className={cn("h-2.5 w-[3px]", index < rung ? "bg-fg" : "bg-border-strong")} />
          ))}
        </span>
      ) : null}
      {value}
    </span>
  );
}

export function ProblemBadges({
  config,
  facets,
}: {
  config: PublicProblemConfig;
  facets: ProblemFacet[];
}) {
  const ladder = facets.find((facet) => facet.key === LADDER);
  const labels = facets
    .filter((facet) => facet.key !== LADDER)
    .flatMap((facet) => facet.values);

  return (
    <>
      {ladder?.values.map((value) => (
        <Ladder key={value} value={value} order={ladder.order} />
      ))}
      {labels.length > 0 ? (
        <span className="text-fg-muted text-xs">{labels.join(" · ")}</span>
      ) : null}
      <span className="text-fg-subtle ml-auto text-xs whitespace-nowrap tabular-nums">
        满分 {config.maxScore}
      </span>
    </>
  );
}
